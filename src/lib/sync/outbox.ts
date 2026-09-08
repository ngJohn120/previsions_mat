// Outbox: durable queue of local writes (persisted in IndexedDB).
import { enqueueOp, listOutbox, removeOp, putConflict } from "@/lib/db";
import { fetchCellServerState } from "@/lib/sync/transport";
import type { SyncOp, Conflict } from "@/lib/sync/types";
import type { FicheRow } from "@/lib/fiche-types";

/** Persist an operation locally (idempotent by opId). */
export function enqueue(op: SyncOp): Promise<void> {
  return enqueueOp(op);
}

/**
 * Convert a conflicted `set_cell` outbox op into a persisted Conflict record
 * and remove the op from the outbox. This is what lets the A/B/C resolver
 * appear when a write is rejected with a version mismatch — without it the op
 * stays stuck in the outbox forever and no conflict UI ever shows.
 * Returns the ficheId the conflict belongs to (for refreshing the resolver),
 * or null when the op isn't a cell write / the cell can't be located.
 */
export async function persistConflictFromOp(op: SyncOp): Promise<string | null> {
  if (op.kind !== "set_cell") return null;
  const located = await locateCell(op.cellId);
  if (!located) return null;

  // Fetch the ACTUAL server value for the conflicted cell. The server rejected
  // our write because a newer version exists — that newer value is the other
  // device's edit and must appear as "Version B" in the resolver. Never fall
  // back to the local cache/rows here: after an offline reload those still
  // hold THIS device's value, which would make Version B identical to A.
  let serverValue = "";
  let serverVersion: number | undefined;
  try {
    const state = await fetchCellServerState(op.cellId);
    serverValue = state?.value ?? "";
    serverVersion = state?.version;
  } catch {
    // Transient fetch failure: keep going; the merge path may fill it later.
  }

  // If the server already holds exactly what we tried to write, there is no
  // real content divergence — the version skew is a false alarm (e.g. after an
  // offline reload the queued op carries a stale expectedVersion). Drop the op
  // without surfacing a resolver the user can't meaningfully resolve.
  if (serverValue === op.value) {
    await removeOp((op as SyncOp & { seq: number }).seq);
    return null;
  }

  const conflict: Conflict = {
    rowUuid: located.rowUuid,
    cellKey: located.cellKey,
    // The value we tried to push (this device's edit).
    localValue: op.value,
    serverValue,
    serverVersion,
    createdAt: Date.now(),
  };
  await putConflict(conflict, located.ficheId);
  await removeOp((op as SyncOp & { seq: number }).seq);
  return located.ficheId;
}

/**
 * Find which fiche + row/col a cell belongs to by scanning the local caches.
 * Returns the ficheId and row/col identity, or null if unknown.
 */
async function locateCell(
  cellId: string
): Promise<{ ficheId: string; rowUuid: string; cellKey: string } | null> {
  const { openDb } = await import("@/lib/db");
  const db = await openDb();
  const all = (await db.getAll("fiche_cache")) as {
    ficheId: string;
    data: { rows: FicheRow[] };
  }[];
  for (const entry of all) {
    for (const row of entry.data.rows ?? []) {
      for (const [colKey, cell] of Object.entries(row.cells ?? {})) {
        if (cell.id === cellId) {
          return { ficheId: entry.ficheId, rowUuid: row.row_uuid, cellKey: colKey };
        }
      }
    }
  }
  return null;
}

export type DrainResult = {
  ok: number;
  failed: number;
  conflicts: number;
};

/**
 * Replay the outbox in order. Each op is handed to `executor`, which should
 * return { ok: true } on success, { conflict: true } for a version mismatch
 * (op stays + flagged), or throw/return { error } otherwise (op stays, retried
 * later). Ops that succeed are removed.
 */
export async function drainOutbox(
  executor: (op: SyncOp) => Promise<{ ok?: boolean; conflict?: boolean; error?: string }>,
  onConflict?: (op: SyncOp) => Promise<void>
): Promise<DrainResult> {
  const ops = await listOutbox();
  const result: DrainResult = { ok: 0, failed: 0, conflicts: 0 };
  for (const op of ops) {
    try {
      const res = await executor(op);
      if (res.ok) {
        await removeOp(op.seq);
        result.ok++;
      } else if (res.conflict) {
        // Surface the conflict to the caller (which should persist a Conflict
        // record and remove the op) so it doesn't stay stuck in the outbox.
        if (onConflict) {
          await onConflict(op);
        }
        result.conflicts++;
      } else {
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}
