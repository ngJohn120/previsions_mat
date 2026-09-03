import { describe, it, expect, vi, beforeEach } from "vitest";
import { drainOutbox } from "@/lib/sync/outbox";
import type { SyncOp } from "@/lib/sync/types";

// Mock the db module so outbox logic is testable in node.
const store: { seq: number; ops: (SyncOp & { seq: number })[] } = {
  seq: 0,
  ops: [],
};

vi.mock("@/lib/db", () => ({
  enqueueOp: vi.fn(async (op: SyncOp) => {
    store.seq += 1;
    store.ops.push({ ...op, seq: store.seq });
  }),
  listOutbox: vi.fn(async () => [...store.ops].sort((a, b) => a.seq - b.seq)),
  removeOp: vi.fn(async (seq: number) => {
    const i = store.ops.findIndex((o) => o.seq === seq);
    if (i >= 0) store.ops.splice(i, 1);
  }),
  countOutbox: vi.fn(async () => store.ops.length),
  clearOutbox: vi.fn(async () => {
    store.ops = [];
    store.seq = 0;
  }),
}));

function cellOp(seq: number, cellId: string, value: string): SyncOp & { seq: number } {
  return {
    seq,
    opId: `op-${cellId}-${value}`,
    kind: "set_cell",
    cellId,
    value,
    expectedVersion: 1,
    createdAt: seq,
  };
}

describe("drainOutbox", () => {
  beforeEach(() => {
    store.ops = [];
    store.seq = 0;
  });

  it("replays ops in insertion order and removes the successful ones", async () => {
    store.ops = [cellOp(1, "c1", "a"), cellOp(2, "c2", "b"), cellOp(3, "c3", "c")];
    const seen: string[] = [];
    const res = await drainOutbox(async (op) => {
      if (op.kind === "set_cell") seen.push(op.cellId);
      return { ok: true };
    });
    expect(seen).toEqual(["c1", "c2", "c3"]);
    expect(res).toEqual({ ok: 3, failed: 0, conflicts: 0 });
    expect(store.ops).toHaveLength(0);
  });

  it("keeps ops that conflict or fail, and counts them", async () => {
    store.ops = [cellOp(1, "c1", "a"), cellOp(2, "c2", "b")];
    let n = 0;
    const res = await drainOutbox(async () => {
      n++;
      if (n === 1) return { conflict: true };
      return { error: "offline" };
    });
    expect(res).toEqual({ ok: 0, failed: 1, conflicts: 1 });
    expect(store.ops).toHaveLength(2);
  });
});
