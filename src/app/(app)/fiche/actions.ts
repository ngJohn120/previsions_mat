"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

type Result = { error?: string; ok?: boolean; newVersion?: number };

async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Save a single cell value through the RPC (online path). */
export async function saveCellValue(input: {
  cellId: string;
  value: string;
  expectedVersion?: number | null;
}): Promise<Result> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("set_cell_value", {
    p_cell_id: input.cellId,
    p_value: input.value,
    p_expected_version: input.expectedVersion ?? null,
  });

  if (error) return { error: error.message };
  // RPC returns a table — take first row
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (row && !row.ok) return { error: row.message };
  return { ok: true, newVersion: row?.new_version };
}

/** Submit a fiche after completeness validation (server-side RPC). */
export async function submitFicheAction(
  ficheId: string
): Promise<Result & { message?: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("submit_fiche", {
    p_fiche_id: ficheId,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (row && !row.ok) return { error: row.message, message: row.message };
  revalidatePath(`/fiche/${ficheId}`);
  revalidatePath("/enseignant");
  return { ok: true };
}
