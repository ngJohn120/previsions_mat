import { createClient } from "@/lib/supabase/server";
import type { RowSeed } from "@/lib/calendar";

export type TemplateRow = {
  id: string;
  row_uuid: string;
  ordre: number;
  row_type: "enseignement" | "evenement";
  mois: string | null;
  semaine_num: number | null;
  date_label: string | null;
  periode_label: string | null;
  evenement_label: string | null;
};

/** Active template version for a year+section, with its rows. */
export async function templateVersionFor(
  yearId: string,
  section: "primaire" | "secondaire"
): Promise<{ version: { id: string; version: number }; rows: TemplateRow[] } | null> {
  const supabase = await createClient();
  const { data: tv } = await supabase
    .from("template_versions")
    .select("id, version")
    .eq("school_year_id", yearId)
    .eq("section", section)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!tv) return null;

  const { data: rows } = await supabase
    .from("template_rows")
    .select("*")
    .eq("template_version_id", tv.id)
    .order("ordre");
  return { version: tv, rows: (rows ?? []) as TemplateRow[] };
}

/**
 * Create a NEW template version from a set of row seeds, marking it active.
 * Deactivates previous active version for the same year+section.
 */
export async function createNewTemplateVersion(
  yearId: string,
  section: "primaire" | "secondaire",
  rows: RowSeed[]
): Promise<{ id: string; version: number } | { error: string }> {
  const supabase = await createClient();

  // Next version number
  const { data: last } = await supabase
    .from("template_versions")
    .select("version")
    .eq("school_year_id", yearId)
    .eq("section", section)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (last?.version ?? 0) + 1;

  // Insert template version (active) — RLS: super admin only
  const { data: tv, error: tvErr } = await supabase
    .from("template_versions")
    .insert({
      school_year_id: yearId,
      section,
      version: nextVersion,
      is_active: true,
    })
    .select("id")
    .single();
  if (tvErr || !tv) return { error: tvErr?.message ?? "Erreur création version" };

  // Deactivate previous
  await supabase
    .from("template_versions")
    .update({ is_active: false })
    .eq("school_year_id", yearId)
    .eq("section", section)
    .neq("id", tv.id);

  // Insert rows
  const seeds = rows.map((r) => ({
    template_version_id: tv.id,
    row_uuid: crypto.randomUUID(),
    ordre: r.ordre,
    row_type: r.row_type,
    mois: r.mois,
    semaine_num: r.semaine_num,
    date_label: r.date_label,
    periode_label: r.periode_label,
    evenement_label: r.evenement_label,
  }));
  const { error: rowsErr } = await supabase.from("template_rows").insert(seeds);
  if (rowsErr) return { error: rowsErr.message };

  return { id: tv.id, version: nextVersion };
}

/**
 * Apply a template version's rows to a set of draft fiches, matching by row_uuid
 * so existing cell content is preserved where the row identity matches.
 */
export async function applyTemplateVersionToFiches(
  templateVersionId: string,
  ficheIds: string[]
): Promise<{ error?: string; updated: number }> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("template_rows")
    .select("*")
    .eq("template_version_id", templateVersionId)
    .order("ordre");
  if (!rows) return { error: "Version introuvable", updated: 0 };

  let updated = 0;
  for (const ficheId of ficheIds) {
    // Only draft fiches
    const { data: fiche } = await supabase.from("fiches").select("statut").eq("id", ficheId).single();
    if (!fiche || fiche.statut !== "brouillon") continue;

    // Existing rows for this fiche
    const { data: existing } = await supabase.from("fiche_rows").select("*").eq("fiche_id", ficheId);
    const byUuid = new Map((existing ?? []).map((r) => [r.row_uuid, r]));

    // Insert/update rows: preserve cells where row_uuid matches (skip re-creating content)
    for (const tr of rows) {
      const match = byUuid.get(tr.row_uuid);
      if (match) {
        // Update row fields in case labels changed
        await supabase.from("fiche_rows").update({
          ordre: tr.ordre,
          row_type: tr.row_type,
          mois: tr.mois,
          semaine_num: tr.semaine_num,
          date_label: tr.date_label,
          periode_label: tr.periode_label,
          evenement_label: tr.evenement_label,
        }).eq("id", match.id);
      } else {
        const { data: newRow } = await supabase.from("fiche_rows").insert({
          fiche_id: ficheId,
          row_uuid: tr.row_uuid,
          ordre: tr.ordre,
          row_type: tr.row_type,
          mois: tr.mois,
          semaine_num: tr.semaine_num,
          date_label: tr.date_label,
          periode_label: tr.periode_label,
          evenement_label: tr.evenement_label,
        }).select("id").single();
        // Add empty cells for known columns
        if (newRow) {
          const cols = ["matieres", "ref", "intention", "obs", "heure", "mv"];
          await supabase.from("fiche_cells").insert(
            cols.map((c) => ({ fiche_row_id: newRow.id, col_key: c, value: "" }))
          );
        }
      }
    }
    updated++;
  }

  return { updated };
}
