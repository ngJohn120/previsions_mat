// Sync operation types shared between the outbox and the engine.

/** A cell-level write op. Version is the expected (base) server version. */
export type CellOp = {
  opId: string;
  kind: "set_cell";
  cellId: string;
  value: string;
  expectedVersion: number;
  createdAt: number;
};

/** A fiche status transition (submit / unlock-approved handled via RPC). */
export type TransitionOp = {
  opId: string;
  kind: "transition";
  ficheId: string;
  action: "submit" | "request_unlock";
  motif?: string;
  createdAt: number;
};

/** A whole-row upsert (template/event rows are admin-only; reserved). */
export type RowOp = {
  opId: string;
  kind: "upsert_row";
  ficheId: string;
  row: unknown;
  createdAt: number;
};

export type SyncOp = CellOp | TransitionOp | RowOp;

export type Conflict = {
  /** Stable row identity (row_uuid) or cell id. */
  rowUuid: string;
  cellKey: string;
  localValue: string;
  serverValue: string;
};

export type SyncStatus = "online" | "offline" | "syncing" | "conflit";
