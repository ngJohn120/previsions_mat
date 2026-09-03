"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { templateVersionFor } from "@/lib/templates";

type Result = { error?: string };

async function requireAttributionAccess(section: "primaire" | "secondaire") {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, section)) redirect("/");
  return user;
}

export async function createAttribution(input: {
  school_year_id: string;
  section: "primaire" | "secondaire";
  classe_id: string;
  branche_id: string;
  sous_branche_id?: string | null;
  enseignant_id: string;
}): Promise<Result> {
  await requireAttributionAccess(input.section);
  const supabase = await createClient();

  // Insert attribution
  const { data: attr, error } = await supabase
    .from("attributions")
    .insert({
      school_year_id: input.school_year_id,
      classe_id: input.classe_id,
      branche_id: input.branche_id,
      sous_branche_id: input.sous_branche_id ?? null,
      enseignant_id: input.enseignant_id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Create draft fiche from the active template (if any)
  const tpl = await templateVersionFor(input.school_year_id, input.section);
  if (tpl) {
    const { data: fiche } = await supabase
      .from("fiches")
      .insert({
        attribution_id: attr.id,
        school_year_id: input.school_year_id,
        statut: "brouillon",
      })
      .select("id")
      .single();
    if (fiche) {
      for (const tr of tpl.rows) {
        const { data: row } = await supabase
          .from("fiche_rows")
          .insert({
            fiche_id: fiche.id,
            row_uuid: tr.row_uuid,
            ordre: tr.ordre,
            row_type: tr.row_type,
            mois: tr.mois,
            semaine_num: tr.semaine_num,
            date_label: tr.date_label,
            periode_label: tr.periode_label,
            evenement_label: tr.evenement_label,
          })
          .select("id")
          .single();
        if (row) {
          const cols = ["matieres", "ref", "intention", "obs", "heure", "mv"];
          await supabase.from("fiche_cells").insert(
            cols.map((c) => ({ fiche_row_id: row.id, col_key: c, value: "" }))
          );
        }
      }
    }
  }

  revalidatePath(`/${input.section}/attributions`);
  return {};
}

export async function updateAttribution(input: {
  id: string;
  section: "primaire" | "secondaire";
  classe_id: string;
  branche_id: string;
  sous_branche_id?: string | null;
  enseignant_id: string;
}): Promise<Result> {
  await requireAttributionAccess(input.section);
  const supabase = await createClient();

  // Block editing if the fiche is submitted
  const { data: fiche } = await supabase.from("fiches").select("statut").eq("attribution_id", input.id).maybeSingle();
  if (fiche && fiche.statut === "soumise") {
    return { error: "Impossible de modifier une attribution dont la fiche est soumise." };
  }

  const { error } = await supabase
    .from("attributions")
    .update({
      classe_id: input.classe_id,
      branche_id: input.branche_id,
      sous_branche_id: input.sous_branche_id ?? null,
      enseignant_id: input.enseignant_id,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath(`/${input.section}/attributions`);
  return {};
}

export async function deleteAttribution(id: string, section: "primaire" | "secondaire"): Promise<Result> {
  await requireAttributionAccess(section);
  const supabase = await createClient();
  const { data: fiche } = await supabase.from("fiches").select("statut").eq("attribution_id", id).maybeSingle();
  if (fiche && fiche.statut === "soumise") {
    return { error: "Impossible de supprimer : la fiche associée est soumise." };
  }
  const { error } = await supabase.from("attributions").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/${section}/attributions`);
  return {};
}
