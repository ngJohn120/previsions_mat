// Outbox: durable queue of local writes (persisted in IndexedDB).
import { enqueueOp, listOutbox, removeOp } from "@/lib/db";
import type { SyncOp } from "@/lib/sync/types";

/** Persist an operation locally (idempotent by opId). */
export function enqueue(op: SyncOp): Promise<void> {
  return enqueueOp(op);
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
  executor: (op: SyncOp) => Promise<{ ok?: boolean; conflict?: boolean; error?: string }>
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
        // keep op + mark conflict (resolver clears it)
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
