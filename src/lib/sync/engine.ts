// Sync engine — pull/merge/conflict logic (pure + testable).
import type { FicheCellMap, FicheRow } from "@/lib/fiche-types";

export type CellRecord = { id: string; value: string; version: number };

/**
 * Pure merge: given the locally cached rows and the freshly pulled server
 * rows/cells, produce:
 *  - merged rows (server wins for changed cell values, except where a local
 *    pending edit exists — handled by the caller keeping the outbox).
 *  - conflicts[] for same-cell divergence where neither side is empty and
 *    versions differ.
 */
export function mergeRows(
  localRows: FicheRow[],
  serverRows: FicheRow[]
): { rows: FicheRow[]; conflicts: { rowUuid: string; cellKey: string; localValue: string; serverValue: string }[] } {
  const conflicts: { rowUuid: string; cellKey: string; localValue: string; serverValue: string }[] = [];
  const serverById = new Map(serverRows.map((r) => [r.id, r]));
  const merged: FicheRow[] = [];

  for (const local of localRows) {
    const server = serverById.get(local.id);
    if (!server) {
      // Server doesn't have this row (deleted?) — drop from view
      continue;
    }
    const cells: FicheCellMap = {};
    // Union of col keys
    const keys = new Set([...Object.keys(local.cells), ...Object.keys(server.cells)]);
    for (const key of keys) {
      const lc = local.cells[key];
      const sc = server.cells[key];
      if (lc && sc) {
        if (lc.value !== sc.value && lc.version !== sc.version) {
          // Divergence: if local version is ahead (pending write), keep local &
          // flag conflict unless local is empty (deletion not a conflict).
          if (lc.value.trim() === "") {
            cells[key] = sc; // server cleared it
          } else if (sc.value.trim() === "") {
            cells[key] = lc; // local added, server empty → keep local
          } else if (lc.version > sc.version) {
            // local was edited later — flag conflict so user can choose
            conflicts.push({
              rowUuid: local.row_uuid,
              cellKey: key,
              localValue: lc.value,
              serverValue: sc.value,
            });
            cells[key] = lc; // keep local optimistic; resolver clears
          } else {
            // server edited later — take server
            cells[key] = sc;
          }
        } else {
          cells[key] = sc; // identical or same version → server truth
        }
      } else if (sc) {
        cells[key] = sc;
      } else if (lc) {
        cells[key] = lc;
      }
    }
    merged.push({ ...local, cells });
  }

  // Rows on server but absent locally (created elsewhere) — add them
  const localIds = new Set(localRows.map((r) => r.id));
  for (const s of serverRows) {
    if (!localIds.has(s.id)) merged.push(s);
  }

  return { rows: merged, conflicts };
}

/** Idempotency helper: build a stable opId from content. */
export function opIdFor(kind: string, payload: string): string {
  // Simple deterministic hash (djb2) — adequate for dedupe, not crypto.
  let h = 5381;
  const s = `${kind}:${payload}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${kind}_${h.toString(36)}_${s.length}`;
}
