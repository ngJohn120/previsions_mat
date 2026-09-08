"use client";

// Browser transport: execute sync ops against Supabase RPCs and pull fresh
// server state for a fiche. Client-only (uses the browser supabase client).
import { createClient } from "@/lib/supabase/client";
import type { SyncOp } from "@/lib/sync/types";
import type { FicheRow } from "@/lib/fiche-types";

/**
 * Execute one outbox op against the server.
 * Returns:
 *  - ok:true on success
 *  - conflict:true when the server reports a version mismatch
 *  - error message otherwise (offline / auth / transient)
 */
export async function executeOp(
  op: SyncOp
): Promise<{ ok?: boolean; conflict?: boolean; error?: string }> {
  const supabase = createClient();

  if (op.kind === "set_cell") {
    const { data, error } = await supabase.rpc("set_cell_value", {
      p_cell_id: op.cellId,
      p_value: op.value,
      p_expected_version: op.expectedVersion,
    });
    if (error) {
      // version_mismatch error string from RPC
      if (/conflit|version/i.test(error.message)) return { conflict: true };
      return { error: error.message };
    }
    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (row && !row.ok) {
      if (/conflit|version/i.test(row.message)) return { conflict: true };
      return { error: row.message };
    }
    return { ok: true };
  }

  if (op.kind === "transition") {
    if (op.action === "submit") {
      const { data, error } = await supabase.rpc("submit_fiche", {
        p_fiche_id: op.ficheId,
      });
      if (error) return { error: error.message };
      const row = Array.isArray(data) && data.length ? data[0] : null;
      if (row && !row.ok) return { error: row.message };
      return { ok: true };
    }
    if (op.action === "request_unlock") {
      const { data, error } = await supabase.rpc("request_unlock", {
        p_fiche_id: op.ficheId,
        p_motif: op.motif ?? "",
      });
      if (error) return { error: error.message };
      const row = Array.isArray(data) && data.length ? data[0] : null;
      if (row && !row.ok) return { error: row.message };
      return { ok: true };
    }
    return { error: "Transition inconnue" };
  }

  return { error: "Opération non supportée (admin)" };
}

/**
 * Fetch the current server value + version of a single cell. Used when an
 * outbox write is rejected with a version conflict, so the resolver can show
 * the *actual* server value (not a stale local/cache value).
 */
export async function fetchCellServerState(
  cellId: string
): Promise<{ value: string; version: number } | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fiche_cells")
    .select("value, version")
    .eq("id", cellId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Pull the latest rows + cells for a fiche (RLS-scoped). */
export async function pullFicheRows(ficheId: string): Promise<FicheRow[]> {
  const supabase = createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("fiche_rows")
    .select("*")
    .eq("fiche_id", ficheId)
    .order("ordre");
  // A failed network/API call must not be mistaken for "the fiche has no rows"
  // — otherwise the merge step below would wipe the locally shown grid.
  if (rowsError) throw new Error(rowsError.message);
  const { data: cells, error: cellsError } = await supabase
    .from("fiche_cells")
    .select("id, fiche_row_id, col_key, value, version")
    .in("fiche_row_id", (rows ?? []).map((r) => r.id));
  if (cellsError) throw new Error(cellsError.message);

  const cellMap = new Map<string, Record<string, { id: string; value: string; version: number }>>();
  for (const c of cells ?? []) {
    const m = cellMap.get(c.fiche_row_id) ?? {};
    m[c.col_key] = { id: c.id, value: c.value, version: c.version };
    cellMap.set(c.fiche_row_id, m);
  }

  return (rows ?? []).map((r) => ({
    id: r.id,
    fiche_id: r.fiche_id,
    row_uuid: r.row_uuid,
    ordre: r.ordre,
    row_type: r.row_type,
    mois: r.mois,
    semaine_num: r.semaine_num,
    date_label: r.date_label,
    periode_label: r.periode_label,
    evenement_label: r.evenement_label,
    cells: cellMap.get(r.id) ?? {},
  }));
}
