"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";

type Result = { error?: string };

async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.roles)) redirect("/login");
}

/** Step 1: create a new school year (optionally cloning structure from a source year). */
export async function createSchoolYear(input: {
  label: string;
  start_date: string;
  end_date: string;
  clone_from_year_id?: string | null;
  clone_calendars?: boolean;
}): Promise<{ id?: string; error?: string }> {
  await requireSuperAdmin();
  if (!input.label.trim() || !input.start_date || !input.end_date) {
    return { error: "Libellé et dates obligatoires." };
  }
  const supabase = await createClient();

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

  // Clone structure if requested
  if (input.clone_from_year_id) {
    const cloneRes = await cloneStructure(input.clone_from_year_id, newYearId);
    if (cloneRes.error) return { error: cloneRes.error };
    if (input.clone_calendars) {
      await cloneCalendars(input.clone_from_year_id, newYearId);
    }
  }

  revalidatePath("/admin/annee");
  return { id: newYearId };
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
    // Map by original class row — need source id; simplest: re-fetch mapping by name+section below
    classIdMap.set(`${c.section}:${c.name}`, newClass.id);
  }

  // Attributions (match classes by section:name, branches by name, sous by name)
  const { data: attrs } = await supabase
    .from("attributions")
    .select("classe_id, branche_id, sous_branche_id, enseignant_id, classe:classes!inner(section, name), branche:branches!inner(name), sous:sous_branches!inner(name)")
    .eq("school_year_id", fromYearId);

  for (const a of attrs ?? []) {
    const srcClass = a.classe as any;
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

/** Step 5: mark a year active and archive the previous active one. */
export async function activateYear(yearId: string): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();

  // Archive current active year(s)
  await supabase.from("school_years").update({ status: "archived" }).eq("status", "active");

  // Activate new year
  const { error } = await supabase.from("school_years").update({ status: "active" }).eq("id", yearId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  revalidatePath("/admin/annee");
  return {};
}
