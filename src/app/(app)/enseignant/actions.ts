"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { cookies } from "next/headers";

const YEAR_COOKIE = "pm_year";

export async function requestFicheUnlock(
  ficheId: string,
  motif: string
): Promise<{ error?: string; ok?: boolean }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!motif.trim()) return { error: "Le motif est obligatoire." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_unlock", {
    p_fiche_id: ficheId,
    p_motif: motif.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath("/enseignant");
  return { ok: true };
}

export async function exportFichesCsv(): Promise<{ csv?: string; filename?: string; error?: string }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  // The teacher's accessible attributions (RLS scoped) for the year.
  const { data: attribs, error } = await supabase
    .from("attributions")
    .select(
      "classe:classes(name), branche:branches(name), sous_branche:sous_branches(name), fiche:fiches(id, statut, updated_at)"
    )
    .eq("school_year_id", cookieYear ?? "");

  if (error) return { error: error.message };

  const rows = (attribs ?? []).filter((a: any) => a.fiche);
  const header = ["Classe", "Cours", "Sous-branche", "État", "Dernière modif."];
  const lines = rows.map((r: any) => [
    r.classe?.name ?? "",
    r.branche?.name ?? "",
    r.sous_branche?.name ?? "",
    r.fiche?.statut ?? "",
    r.fiche?.updated_at ?? "",
  ]);

  const csv = [header, ...lines]
    .map((row) =>
      row
        .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  return { csv, filename: `mes-fiches-${new Date().toISOString().slice(0, 10)}.csv` };
}
