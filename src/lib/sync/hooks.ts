"use client";

// Client hooks for local-first fiche editing + sync status.
import { useCallback, useEffect, useRef, useState } from "react";
import { cacheFiche, getCachedFiche, countOutbox, listConflicts, removeConflict } from "@/lib/db";
import { enqueue, drainOutbox, persistConflictFromOp } from "@/lib/sync/outbox";
import { executeOp, pullFicheRows } from "@/lib/sync/transport";
import { mergeRows } from "@/lib/sync/engine";
import { putConflict } from "@/lib/db";
import type { SyncOp, SyncStatus } from "@/lib/sync/types";
import type { FicheWithRows, FicheRow } from "@/lib/fiche-types";

function online(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/** Shared onConflict handler for outbox drains: persist + surface. */
async function handleDrainConflict(op: SyncOp): Promise<void> {
  const ficheId = await persistConflictFromOp(op);
  if (ficheId) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pm:conflicts-changed", { detail: { ficheId } })
      );
    }
  }
}

/**
 * Remove stored conflicts for a fiche whose local and server values have
 * converged (identical content on both sides now), or whose row/cell no longer
 * exists on the server. Prevents the resolver from showing stale duplicates
 * (e.g. both devices ended up with the same value) that the user can't
 * meaningfully resolve.
 */
async function pruneConvergedConflicts(
  ficheId: string,
  serverRows: FicheRow[],
  merged: FicheRow[]
): Promise<void> {
  try {
    const stored = await listConflicts(ficheId);
    const serverById = new Map(serverRows.map((r) => [r.id, r]));
    for (const c of stored) {
      // Find the merged row (server truth + local optimistic) for this conflict.
      const mergedRow = merged.find((r) => r.row_uuid === c.rowUuid);
      if (!mergedRow) {
        await removeConflict(c.key);
        continue;
      }
      const serverRow = serverById.get(mergedRow.id);
      const serverCell = serverRow?.cells[c.cellKey];
      // If the row is gone from the server, or the server's current value now
      // equals what this device tried to write, there's nothing to resolve.
      if (!serverCell || serverCell.value === c.localValue) {
        await removeConflict(c.key);
      }
    }
  } catch {
    // Pruning is best-effort; never fail a sync because of it.
  }
}

/**
 * Load a fiche's rows from the local cache (IndexedDB), falling back to the
 * server-passed initial data. After mount, if online, pulls the latest server
 * rows and merges (detecting conflicts).
 */
export function useLocalFiche(ficheId: string, initial: FicheWithRows) {
  const [rows, setRows] = useState<FicheRow[]>(initial.rows);
  // Start neutral ("syncing") so the server render and first client render
  // match — navigator.onLine only exists client-side, so using it in the
  // initializer would cause a hydration mismatch (and a full client tree
  // regeneration) on every editor load. The mount effect below sets the real
  // status immediately after hydration.
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const syncingRef = useRef(false);

  // Set the true connectivity status only after mount (client-only).
  useEffect(() => {
    // Intentional one-time post-hydration status set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(online() ? "online" : "offline");
  }, []);

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
        await drainOutbox(
          async (op: SyncOp) => executeOp(op),
          handleDrainConflict
        );
      }
      // 2. Pull server state and merge with cache.
      const serverRows = await pullFicheRows(ficheId);
      const cached = (await getCachedFiche<{ rows: FicheRow[] }>(ficheId)) ?? initial;
      const { rows: merged, conflicts } = mergeRows(cached.rows, serverRows);
      for (const c of conflicts) {
        await putConflict({ ...c, createdAt: Date.now() }, ficheId);
      }
      // 3. Prune stored conflicts whose two sides have converged (e.g. the
      // other device later saved the same value, or this device's edit reached
      // the server after all) so the resolver never shows stale duplicates.
      await pruneConvergedConflicts(ficheId, serverRows, merged);
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

  // Auto-sync once on mount (if online). When starting offline, load cache.
  useEffect(() => {
    if (!online()) {
      // load cache if available
      getCachedFiche<{ rows: FicheRow[] }>(ficheId).then((c) => {
        if (c?.rows?.length) setRows(c.rows);
      });
      return;
    }
    // Mount sync is intentional (once per fiche). The rule only fires because
    // sync() calls setState internally after an async op.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficheId]);

  // React to connectivity changes: flip to "offline" immediately when the
  // network drops; when it returns, re-sync so the pill recovers to online.
  useEffect(() => {
    const onOnline = () => {
      if (syncingRef.current) return;
      sync();
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [sync]);

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
      // Prefer the version in the local cache: it advances after each queued
      // edit, whereas the initially-rendered grid version can be stale.
      const cached = await getCachedFiche<{ rows: FicheRow[] }>(ficheId);
      const cachedCell = cached?.rows
        .flatMap((row) => Object.values(row.cells))
        .find((cell) => cell.id === cellId);
      const localVersion = cachedCell?.version ?? expectedVersion;
      const op: SyncOp = {
        opId: `cell:${cellId}:${Date.now()}`,
        kind: "set_cell",
        cellId,
        value,
        expectedVersion: localVersion,
        createdAt: Date.now(),
      };
      // 1. persist op
      await enqueue(op);
      markDirty(1);

      // 2. update cache value and version for subsequent edits to this cell.
      if (cached?.rows) {
        const rows = cached.rows.map((row) => {
          const entry = Object.entries(row.cells).find(([, cell]) => cell.id === cellId);
          if (!entry) return row;
          const [colKey, cell] = entry;
          return {
            ...row,
            cells: {
              ...row.cells,
              [colKey]: { ...cell, value, version: localVersion + 1 },
            },
          };
        });
        await cacheFiche(ficheId, { ...cached, rows });
      }

      // 3. if online, drain now (best-effort); sync pending count with outbox
      if (online()) {
        drainOutbox(
          async (o) => executeOp(o),
          handleDrainConflict
        )
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
