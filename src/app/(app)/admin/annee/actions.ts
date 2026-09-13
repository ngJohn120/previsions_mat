"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin, type Section } from "@/lib/auth";
import { seedRosterForYear, orphanAssignments, setRosterActive } from "@/lib/roster";

type Result = { error?: string };

async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.roles)) redirect("/login");
}

/** Step 5 (wizard): create the year for revision — row + optional structure/
 *  calendar clone, status "upcoming". NOT activated here: section admins must
 *  validate their section on the Révision page before activation. */
export async function createYearForRevision(input: {
  label: string;
  start_date: string;
  end_date: string;
  clone_from_year_id?: string | null;
  clone_calendars?: boolean;
}): Promise<Result & { id?: string }> {
  await requireSuperAdmin();
  if (!input.label.trim() || !input.start_date || !input.end_date) {
    return { error: "Libellé et dates obligatoires." };
  }
  const supabase = await createClient();

  // 1. Create the year row (upcoming — not yet active).
  const { data: year, error } = await supabase
    .from("school_years")
    .insert({
      label: input.label.trim(),
      start_date: input.start_date,
      end_date: input.end_date,
      status: "upcoming",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const newYearId = year.id;

  // 2. Clone structure (classes + attributions), calendars when requested.
  if (input.clone_from_year_id) {
    const cloneRes = await cloneStructure(input.clone_from_year_id, newYearId);
    if (cloneRes.error) return cloneRes;
    if (input.clone_calendars) {
      await cloneCalendars(input.clone_from_year_id, newYearId);
    }
  }

  // 3. Seed the per-year roster (all current teachers → active for the new
  // year, cloned or blank). A seed failure must surface, not pass silently.
  try {
    await seedRosterForYear(supabase, newYearId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Échec de l'initialisation du personnel." };
  }

  revalidatePath("/admin/annee");
  revalidatePath("/admin/revision");
  return { id: newYearId };
}

/** Section admin validates their section for an upcoming year. RLS enforces
 *  that only the section's own admin can insert the validation row. */
export async function validateSection(input: {
  yearId: string;
  section: Section;
}): Promise<Result> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSectionAdmin(user.roles, input.section)) {
    return { error: "Seul l'administrateur de cette section peut valider." };
  }
  const supabase = await createClient();

  const { data: yearRow } = await supabase
    .from("school_years")
    .select("status")
    .eq("id", input.yearId)
    .single();
  if (!yearRow) return { error: "Année introuvable." };
  if (yearRow.status !== "upcoming") {
    return { error: "Cette année n'est plus en attente de validation." };
  }

  // Personnel gate: no orphan assignments (teachers off this year's roster).
  const orphans = await orphanAssignments(supabase, input.yearId, input.section);
  const orphanCount = orphans.attributionOrphans.length + orphans.titulaireOrphans.length;
  if (orphanCount > 0) {
    const names = [...new Set([
      ...orphans.attributionOrphans.map((o) => o.teacherName),
      ...orphans.titulaireOrphans.map((o) => o.teacherName),
    ])].join(", ");
    return { error: `${orphanCount} cours sont encore assignés à des enseignants hors poste (${names}).` };
  }

  const { error } = await supabase
    .from("year_section_validations")
    .upsert({ school_year_id: input.yearId, section: input.section, validated_by: user.id }, {
      onConflict: "school_year_id,section",
    });
  if (error) return { error: error.message };
  revalidatePath("/admin/revision");
  return {};
}

/** Author (or super admin) revokes a section's validation while the year is
 *  still upcoming. RLS enforces authorship. */
export async function revokeSectionValidation(input: {
  yearId: string;
  section: Section;
}): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("year_section_validations")
    .delete()
    .eq("school_year_id", input.yearId)
    .eq("section", input.section);
  if (error) return { error: error.message };
  revalidatePath("/admin/revision");
  return {};
}

/** Activate / deactivate a teacher on a year's roster. Allowed for the
 *  section's own admin or the super admin (RLS enforces the same rule). */
export async function setTeacherYearActive(input: {
  userId: string;
  schoolYearId: string;
  section: Section;
  isActive: boolean;
}): Promise<Result> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, input.section)) {
    return { error: "Accès refusé." };
  }
  const supabase = await createClient();
  try {
    await setRosterActive(supabase, {
      userId: input.userId,
      schoolYearId: input.schoolYearId,
      section: input.section,
      isActive: input.isActive,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
  revalidatePath("/admin/revision");
  revalidatePath(`/${input.section}/structure`);
  revalidatePath(`/${input.section}/attributions`);
  return {};
}

/** Final activation (Révision page): only once BOTH sections have validated.
 *  Archives the previous active year and activates the new one. */
export async function activateYear(yearId: string): Promise<Result & { id?: string }> {
  await requireSuperAdmin();
  const supabase = await createClient();

  const { data: yearRow } = await supabase
    .from("school_years")
    .select("status")
    .eq("id", yearId)
    .single();
  if (!yearRow) return { error: "Année introuvable." };

  const { data: validations } = await supabase
    .from("year_section_validations")
    .select("section")
    .eq("school_year_id", yearId);
  const sections = new Set((validations ?? []).map((v) => v.section));
  if (!sections.has("primaire") || !sections.has("secondaire")) {
    return { error: "L'activation est verrouillée tant que les deux sections n'ont pas validé leur structure." };
  }

  // Personnel gate (defense in depth): no orphans in either section.
  for (const s of ["primaire", "secondaire"] as const) {
    const orphans = await orphanAssignments(supabase, yearId, s);
    if (orphans.attributionOrphans.length + orphans.titulaireOrphans.length > 0) {
      return { error: "L'activation est verrouillée : des cours sont assignés à des enseignants hors poste." };
    }
  }

  // Archive current active year(s), activate the new one.
  await supabase.from("school_years").update({ status: "archived" }).eq("status", "active");
  const { error: actErr } = await supabase
    .from("school_years")
    .update({ status: "active" })
    .eq("id", yearId);
  if (actErr) return { error: actErr.message };
  revalidatePath("/", "layout");
  revalidatePath("/admin/annee");
  revalidatePath("/admin/revision");
  return { id: yearId };
}

/** Delete an upcoming (not yet active) school year. Safety: only 'upcoming'
 *  years, and only when they carry no classes, attributions or templates —
 *  mirrors the wizard's rule that real data appears only at activation. */
export async function deleteUpcomingYear(yearId: string): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();

  const { data: year } = await supabase
    .from("school_years")
    .select("id, status")
    .eq("id", yearId)
    .single();
  if (!year) return { error: "Année introuvable." };
  if (year.status !== "upcoming") {
    return { error: "Seules les années « À venir » peuvent être supprimées." };
  }

  const { count: classes } = await supabase
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("school_year_id", yearId);
  const { count: attrs } = await supabase
    .from("attributions")
    .select("id", { count: "exact", head: true })
    .eq("school_year_id", yearId);
  const { count: tpls } = await supabase
    .from("template_versions")
    .select("id", { count: "exact", head: true })
    .eq("school_year_id", yearId);
  if ((classes ?? 0) > 0 || (attrs ?? 0) > 0 || (tpls ?? 0) > 0) {
    return { error: "Cette année contient des données (classes, attributions ou modèles) et ne peut pas être supprimée." };
  }

  const { error: delErr } = await supabase.from("school_years").delete().eq("id", yearId);
  if (delErr) return { error: delErr.message };
  revalidatePath("/admin/annee");
  return {};
}

/** Clone classes + attributions from a source year into a target year (no fiches/templates). */
export async function cloneStructure(fromYearId: string, toYearId: string): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();

  // Classes
  const { data: classes } = await supabase
    .from("classes")
    .select("section, name, level, ordre, titulaire_id")
    .eq("school_year_id", fromYearId);

  const classIdMap = new Map<string, string>();
  for (const c of classes ?? []) {
    const { data: newClass, error } = await supabase
      .from("classes")
      .insert({
        school_year_id: toYearId,
        section: c.section,
        name: c.name,
        level: c.level,
        ordre: c.ordre,
        titulaire_id: c.titulaire_id,
      })
      .select("id")
      .single();
    if (error) continue;
    // Map by section:name — the source class id isn't returned by the insert.
    classIdMap.set(`${c.section}:${c.name}`, newClass.id);
  }

  // Attributions (match classes by section:name, branches by name, sous by name)
    // NB: `sous` must NOT use !inner — an attribution without a sous_branche_id
    // would be silently dropped by an inner join.
    const { data: attrs } = await supabase
      .from("attributions")
      .select("classe_id, branche_id, sous_branche_id, enseignant_id, classe:classes!inner(section, name), branche:branches(name), sous:sous_branches(name)")
      .eq("school_year_id", fromYearId);

    for (const a of attrs ?? []) {
      const srcClass = a.classe as unknown as { section: string; name: string };
      const newClassId = classIdMap.get(`${srcClass.section}:${srcClass.name}`);
      if (!newClassId) continue;
      await supabase.from("attributions").insert({
        school_year_id: toYearId,
        classe_id: newClassId,
        branche_id: a.branche_id,
        sous_branche_id: a.sous_branche_id,
        enseignant_id: a.enseignant_id,
      });
    }

  return {};
}

/** Clone template versions (calendar rows) from a source year to a target (new versions, inactive). */
export async function cloneCalendars(fromYearId: string, toYearId: string): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  for (const section of ["primaire", "secondaire"] as const) {
    const { data: tv } = await supabase
      .from("template_versions")
      .select("id, version")
      .eq("school_year_id", fromYearId)
      .eq("section", section)
      .eq("is_active", true)
      .maybeSingle();
    if (!tv) continue;
    const { data: rows } = await supabase.from("template_rows").select("*").eq("template_version_id", tv.id);

    const { data: newTv } = await supabase
      .from("template_versions")
      .insert({ school_year_id: toYearId, section, version: 1, is_active: false })
      .select("id")
      .single();
    if (!newTv) continue;
    if (rows) {
      await supabase.from("template_rows").insert(
        rows.map((r) => ({
          template_version_id: newTv.id,
          row_uuid: r.row_uuid,
          ordre: r.ordre,
          row_type: r.row_type,
          mois: r.mois,
          semaine_num: r.semaine_num,
          date_label: r.date_label,
          periode_label: r.periode_label,
          evenement_label: r.evenement_label,
        }))
      );
    }
  }
  return {};
}