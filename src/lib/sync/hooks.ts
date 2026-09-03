"use client";

// Client hooks for local-first fiche editing + sync status.
import { useCallback, useEffect, useRef, useState } from "react";
import { cacheFiche, getCachedFiche, countOutbox } from "@/lib/db";
import { enqueue } from "@/lib/sync/outbox";
import { drainOutbox } from "@/lib/sync/outbox";
import { executeOp, pullFicheRows } from "@/lib/sync/transport";
import { mergeRows } from "@/lib/sync/engine";
import { putConflict } from "@/lib/db";
import type { SyncOp, SyncStatus } from "@/lib/sync/types";
import type { FicheWithRows, FicheRow } from "@/lib/fiche-types";

function online(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/**
 * Load a fiche's rows from the local cache (IndexedDB), falling back to the
 * server-passed initial data. After mount, if online, pulls the latest server
 * rows and merges (detecting conflicts).
 */
export function useLocalFiche(ficheId: string, initial: FicheWithRows) {
  const [rows, setRows] = useState<FicheRow[]>(initial.rows);
  const [status, setStatus] = useState<SyncStatus>("online");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const syncingRef = useRef(false);

  // Seed cache with initial data on first load.
  useEffect(() => {
    cacheFiche(ficheId, initial).catch(() => {});
  }, [ficheId, initial]);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setStatus("syncing");
    try {
      // 1. Drain any pending local writes first.
      if ((await countOutbox()) > 0) {
        await drainOutbox(async (op: SyncOp) => executeOp(op));
      }
      // 2. Pull server state and merge with cache.
      const serverRows = await pullFicheRows(ficheId);
      const cached = (await getCachedFiche<{ rows: FicheRow[] }>(ficheId)) ?? initial;
      const { rows: merged, conflicts } = mergeRows(cached.rows, serverRows);
      for (const c of conflicts) await putConflict(c, ficheId);
      if (conflicts.length > 0) {
        // Notify the teacher server-side (idempotent per fiche).
        import("@/app/(app)/notifications/actions").then((m) =>
          m.notifyConflictDetected(ficheId).catch(() => {})
        );
      }
      setRows(merged);
      await cacheFiche(ficheId, { ...initial, rows: merged });
      setLastSaved(new Date());
      setStatus(conflicts.length ? "conflit" : online() ? "online" : "offline");
    } catch {
      setStatus(online() ? "online" : "offline");
    } finally {
      syncingRef.current = false;
    }
  }, [ficheId, initial]);

  // Auto-sync once on mount (if online).
  useEffect(() => {
    if (!online()) {
      setStatus("offline");
      // load cache if available
      getCachedFiche<{ rows: FicheRow[] }>(ficheId).then((c) => {
        if (c?.rows?.length) setRows(c.rows);
      });
      return;
    }
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficheId]);

  return { rows, setRows, status, setStatus, sync, lastSaved };
}

/**
 * Writer hook: cell edit → optimistic local update + IndexedDB cache write +
 * outbox enqueue + (if online) background drain.
 */
export function useCellWriter(ficheId: string) {
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);

  const markDirty = useCallback((delta: number) => {
    pendingRef.current = Math.max(0, pendingRef.current + delta);
    setPending(pendingRef.current);
  }, []);

  const writeCell = useCallback(
    async (cellId: string, value: string, expectedVersion: number) => {
      const op: SyncOp = {
        opId: `cell:${cellId}:${Date.now()}`,
        kind: "set_cell",
        cellId,
        value,
        expectedVersion,
        createdAt: Date.now(),
      };
      // 1. persist op
      await enqueue(op);
      markDirty(1);

      // 2. update cache value
      const cached = await getCachedFiche<{ rows: FicheRow[] }>(ficheId);
      if (cached?.rows) {
        const rows = cached.rows.map((r) => {
          const cell = r.cells[cellId];
          if (!cell) return r;
          return {
            ...r,
            cells: {
              ...r.cells,
              [cellId]: { ...cell, value, version: cell.version + 1 },
            },
          };
        });
        await cacheFiche(ficheId, { ...cached, rows });
      }

      // 3. if online, drain now (best-effort); sync pending count with outbox
      if (online()) {
        drainOutbox(async (o) => executeOp(o))
          .then(async () => {
            const left = await countOutbox();
            pendingRef.current = left;
            setPending(left);
          })
          .catch(() => {});
      }
    },
    [ficheId, markDirty]
  );

  const unsynced = pending > 0;

  return { writeCell, unsynced };
}
