"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { validateClassesCsv, type CsvRow } from "@/lib/csv";
import { isRosterMember } from "@/lib/roster";

type Result = { error?: string };
export type ImportResult = { created: number; errors: string[] };

async function requireStructureAccess(section: "primaire" | "secondaire") {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, section)) {
    redirect("/");
  }
  return user;
}

/** Reject teachers who are not on the year's roster (null titulaire passes). */
async function checkTitulaireRoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  titulaireId: string | null | undefined,
  schoolYearId: string,
  section: "primaire" | "secondaire"
): Promise<string | null> {
  if (!titulaireId) return null;
  const member = await isRosterMember(supabase, {
    userId: titulaireId,
    schoolYearId,
    section,
  });
  return member
    ? null
    : "Ce titulaire ne fait pas partie de l'année sélectionnée.";
}

export async function createClass(input: {
  school_year_id: string;
  section: "primaire" | "secondaire";
  name: string;
  level: string;
  ordre: number;
  titulaire_id?: string | null;
}): Promise<Result> {
  await requireStructureAccess(input.section);
  if (!input.name.trim() || !input.level.trim()) {
    return { error: "Le nom et le niveau de la classe sont obligatoires." };
  }
  const supabase = await createClient();
  const rosterErr = await checkTitulaireRoster(
    supabase,
    input.titulaire_id,
    input.school_year_id,
    input.section
  );
  if (rosterErr) return { error: rosterErr };
  const { error } = await supabase.from("classes").insert({
    school_year_id: input.school_year_id,
    section: input.section,
    name: input.name.trim(),
    level: input.level.trim(),
    ordre: input.ordre,
    titulaire_id: input.titulaire_id ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/${input.section}/structure`);
  revalidatePath("/", "layout");
  return {};
}

export async function updateClass(input: {
  id: string;
  section: "primaire" | "secondaire";
  name: string;
  level: string;
  ordre: number;
  titulaire_id?: string | null;
}): Promise<Result> {
  await requireStructureAccess(input.section);
  const supabase = await createClient();
  // The year's id lives on the row being updated — read it for the roster check.
  const { data: existing } = await supabase
    .from("classes")
    .select("school_year_id")
    .eq("id", input.id)
    .maybeSingle();
  if (!existing) return { error: "Classe introuvable. Rechargez la page et réessayez." };
  const rosterErr = await checkTitulaireRoster(
    supabase,
    input.titulaire_id,
    existing.school_year_id,
    input.section
  );
  if (rosterErr) return { error: rosterErr };
  const { error } = await supabase
    .from("classes")
    .update({
      name: input.name.trim(),
      level: input.level.trim(),
      ordre: input.ordre,
      titulaire_id: input.titulaire_id ?? null,
    })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath(`/${input.section}/structure`);
  return {};
}

export async function deleteClass(id: string, section: "primaire" | "secondaire"): Promise<Result> {
  await requireStructureAccess(section);
  const supabase = await createClient();
  const { error } = await supabase.from("classes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/${section}/structure`);
  return {};
}

/**
 * Bulk-delete CLASSES from the structure page. The user chose the same target as
 * the attributions table: each selected class has its attributions and their
 * fiches removed explicitly, so nothing is left orphaned by a cascade and the
 * count reported back is meaningful. Submitted fiches are protected (skipped
 * and reported) exactly like the single-row delete.
 */
export async function deleteClassesBulk(
  classIds: string[],
  section: "primaire" | "secondaire",
  yearId: string
): Promise<Result & { deleted?: number; skipped?: number }> {
  await requireStructureAccess(section);
  const supabase = await createClient();
  const wanted = [...new Set(classIds.filter(Boolean))];
  if (wanted.length === 0) return { deleted: 0, skipped: 0 };

  // Attributions of those classes in the selected year, with their fiche state.
  const { data: attrs } = await supabase
    .from("attributions")
    .select("id, classe_id, fiche:fiches(id, statut)")
    .in("classe_id", wanted)
    .eq("school_year_id", yearId);
  // The embedded `fiche:fiches(...)` relation is typed as an array by the
  // generated client; each attribution has at most one fiche, so take the first.
  const rows = ((attrs ?? []) as unknown as {
    id: string;
    classe_id: string;
    fiche: { id: string; statut: string } | { id: string; statut: string }[] | null;
  }[]).map((a) => ({ ...a, fiche: Array.isArray(a.fiche) ? a.fiche[0] ?? null : a.fiche }));

  // A class holding a SUBMITTED fiche is not removed — the teacher must deal
  // with it first (same protection as the attributions bulk delete).
  const blockedClasses = new Set(
    rows.filter((a) => a.fiche?.statut === "soumise").map((a) => a.classe_id)
  );
  const removableClasses = wanted.filter((id) => !blockedClasses.has(id));
  const removableAttrs = rows.filter((a) => !blockedClasses.has(a.classe_id));
  const ficheIds = removableAttrs.map((a) => a.fiche?.id).filter(Boolean) as string[];

  if (ficheIds.length) {
    const { error: fErr } = await supabase.from("fiches").delete().in("id", ficheIds);
    if (fErr) return { error: fErr.message };
  }
  if (removableAttrs.length) {
    const { error: aErr } = await supabase
      .from("attributions")
      .delete()
      .in("id", removableAttrs.map((a) => a.id));
    if (aErr) return { error: aErr.message };
  }
  if (removableClasses.length) {
    const { error } = await supabase.from("classes").delete().in("id", removableClasses);
    if (error) return { error: error.message };
  }

  revalidatePath(`/${section}/structure`);
  revalidatePath(`/${section}/attributions`);
  return { deleted: removableClasses.length, skipped: wanted.length - removableClasses.length };
}

export async function importClassesCsv(
  section: "primaire" | "secondaire",
  yearId: string,
  rows: CsvRow[]
): Promise<ImportResult> {
  await requireStructureAccess(section);
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data, errors: validation } = validateClassesCsv(rows);
  const errors = validation.map((v) => `Ligne ${v.line} : ${v.message}`);
  let created = 0;

  // Look up existing teachers by email (profiles join user_roles to find teachers)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", data.map((d) => d.titulaire_email).filter(Boolean));

  const emailToId = new Map((profiles ?? []).map((p) => [p.email, p.id]));

  let ordre = 0;
  for (const c of data) {
    ordre++;
    let titulaireId: string | null = null;
    if (c.titulaire_email) {
      titulaireId = emailToId.get(c.titulaire_email) ?? null;
      if (!titulaireId) {
        errors.push(`Ligne : « ${c.name} » — titulaire introuvable (${c.titulaire_email})`);
        continue;
      }
      const rosterErr = await checkTitulaireRoster(supabase, titulaireId, yearId, section);
      if (rosterErr) {
        errors.push(`Ligne : « ${c.name} » — ${rosterErr}`);
        continue;
      }
    }
    const { error } = await supabase.from("classes").insert({
      school_year_id: yearId,
      section,
      name: c.name,
      level: c.level,
      ordre: c.ordre ?? ordre,
      titulaire_id: titulaireId,
    });
    if (error) {
      errors.push(`${c.name} : ${error.message}`);
    } else {
      created++;
    }
  }

  revalidatePath(`/${section}/structure`);
  return { created, errors };
}
