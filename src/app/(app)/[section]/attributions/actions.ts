"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { templateVersionFor, type TemplateRow } from "@/lib/templates";
import { validateAttributionsCsv, type CsvRow } from "@/lib/csv";
import { isRosterMember } from "@/lib/roster";

type Result = { error?: string };
export type ImportResult = { created: number; errors: string[] };

async function requireAttributionAccess(section: "primaire" | "secondaire") {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, section)) redirect("/");
  return user;
}

/** Reject teachers who are not on the year's roster. */
async function checkEnseignantRoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enseignantId: string,
  schoolYearId: string,
  section: "primaire" | "secondaire"
): Promise<string | null> {
  const member = await isRosterMember(supabase, {
    userId: enseignantId,
    schoolYearId,
    section,
  });
  return member
    ? null
    : "Cet enseignant ne fait pas partie de l'année sélectionnée.";
}

/**
 * Create one attribution per requested sous-branche (a teacher assigned to
 * several sous-branches of the same cours gets one row + one fiche each).
 * Empty/omitted list = a single attribution without sous-branche.
 */
export async function createAttribution(input: {
  school_year_id: string;
  section: "primaire" | "secondaire";
  classe_id: string;
  branche_id: string;
  sous_branche_ids?: string[] | null;
  enseignant_id: string;
}): Promise<Result & { created?: number }> {
  await requireAttributionAccess(input.section);
  const supabase = await createClient();

  if (!input.enseignant_id) {
    return { error: "Choisissez un enseignant en poste." };
  }
  const rosterErr = await checkEnseignantRoster(
    supabase,
    input.enseignant_id,
    input.school_year_id,
    input.section
  );
  if (rosterErr) return { error: rosterErr };

  // Guard against duplicates on (classe, branche, sous-branche): the dialog
  // disables already-assigned sous-branches, this covers stale tabs/direct
  // calls. Null sous-branche rows are exempt (Postgres treats each NULL as
  // distinct in the unique constraint, so re-assigning null is allowed).
  const requested = [...new Set((input.sous_branche_ids ?? []).map((s) => s.trim()).filter(Boolean))];
  let toCreate: (string | null)[] = [null];
  if (requested.length > 0) {
    const { data: existing } = await supabase
      .from("attributions")
      .select("sous_branche_id")
      .eq("school_year_id", input.school_year_id)
      .eq("classe_id", input.classe_id)
      .eq("branche_id", input.branche_id);
    const takenIds = new Set(
      (existing ?? []).map((r: { sous_branche_id: string | null }) => r.sous_branche_id).filter(Boolean)
    );
    toCreate = requested.filter((sid) => !takenIds.has(sid));
    if (toCreate.length === 0) {
      const { data: taken } = await supabase
        .from("sous_branches")
        .select("id, name")
        .in("id", requested);
      const label = (taken ?? []).map((n: { name: string }) => n.name).join(", ");
      return { error: `Déjà attribuée${requested.length > 1 ? "s" : ""} pour cette classe et ce cours : ${label}.` };
    }
  }

  // Active template (fetched once) seeds each new fiche.
  const tpl = await templateVersionFor(input.school_year_id, input.section);

  let created = 0;
  for (const sid of toCreate) {
    const { data: attr, error } = await supabase
      .from("attributions")
      .insert({
        school_year_id: input.school_year_id,
        classe_id: input.classe_id,
        branche_id: input.branche_id,
        sous_branche_id: sid,
        enseignant_id: input.enseignant_id,
      })
      .select("id")
      .single();
    if (error) {
      // 23505 = unique violation (raced duplicate) — skip, others still create.
      if ((error as { code?: string }).code === "23505") continue;
      return { error: error.message };
    }
    created++;
    if (tpl) await seedFiche(supabase, attr.id, input.school_year_id, tpl.rows);
  }

  if (created === 0) {
    return { error: "Aucune attribution créée (déjà existantes)." };
  }

  revalidatePath(`/${input.section}/attributions`);
  return { created };
}

/** Draft fiche + template rows + empty cells for a new attribution (best effort). */
async function seedFiche(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attributionId: string,
  schoolYearId: string,
  templateRows: TemplateRow[]
): Promise<void> {
  const { data: fiche } = await supabase
    .from("fiches")
    .insert({
      attribution_id: attributionId,
      school_year_id: schoolYearId,
      statut: "brouillon",
    })
    .select("id")
    .single();
  if (!fiche) return;
  for (const tr of templateRows) {
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

  // The year's id lives on the row being updated — read it for the roster check.
  const { data: existing } = await supabase
    .from("attributions")
    .select("school_year_id")
    .eq("id", input.id)
    .maybeSingle();
  if (!existing) return { error: "Attribution introuvable. Rechargez la page et réessayez." };
  if (!input.enseignant_id) {
    return { error: "Choisissez un enseignant en poste." };
  }
  const rosterErr = await checkEnseignantRoster(
    supabase,
    input.enseignant_id,
    existing.school_year_id,
    input.section
  );
  if (rosterErr) return { error: rosterErr };

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

export async function importAttributionsCsv(
  section: "primaire" | "secondaire",
  yearId: string,
  rows: CsvRow[]
): Promise<ImportResult> {
  await requireAttributionAccess(section);
  const supabase = await createClient();
  const { data, errors: validation } = validateAttributionsCsv(rows);
  const errors = validation
    .filter((v) => (rows[v.line - 2]?.[0] ?? "").toLowerCase() === section)
    .map((v) => `Ligne ${v.line} : ${v.message}`);
  const sectionRows = data.filter((d) => d.section === section);
  let created = 0;

  // Look up classes by (section, name), branches by name, sous_branches by (branche,name), teachers by email
  const classNames = sectionRows.map((d) => d.classe);
  const branchNames = sectionRows.map((d) => d.branche);
  const emails = sectionRows.map((d) => d.enseignant_email);

  const [classesRes, branchesRes, sousRes, usersRes] = await Promise.all([
    supabase.from("classes").select("id, name").eq("school_year_id", yearId).eq("section", section).in("name", classNames),
    supabase.from("branches").select("id, name").in("name", branchNames),
    supabase.from("sous_branches").select("id, name, branche_id"),
    createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const classId = new Map((classesRes.data ?? []).map((c) => [c.name, c.id]));
  const branchId = new Map((branchesRes.data ?? []).map((b) => [b.name, b.id]));
  const allUsers = usersRes.data?.users ?? [];
  const teacherId = new Map(allUsers.map((u) => [u.email, u.id]));
  // Ensure listed teachers exist in profiles too (they should, but be safe)
  const profileEmails = allUsers.filter((u) => emails.includes(u.email ?? "")).map((u) => u.id);
  if (profileEmails.length) {
    const { data: profiles } = await supabase.from("profiles").select("id").in("id", profileEmails);
    const existing = new Set((profiles ?? []).map((p) => p.id));
    for (const u of allUsers) {
      if (emails.includes(u.email ?? "") && !existing.has(u.id)) {
        await supabase.from("profiles").insert({ id: u.id, full_name: u.user_metadata?.full_name ?? u.email ?? "" });
      }
    }
  }
  // sous_branche lookup by name only is ambiguous across branches; resolve after branch known
  const sousByBranch = new Map<string, { id: string; name: string }[]>();
  for (const s of sousRes.data ?? []) {
    const arr = sousByBranch.get(s.branche_id) ?? [];
    arr.push({ id: s.id, name: s.name });
    sousByBranch.set(s.branche_id, arr);
  }

  for (const d of sectionRows) {
    const cid = classId.get(d.classe);
    const bid = branchId.get(d.branche);
    const tid = teacherId.get(d.enseignant_email);
    if (!cid) {
      errors.push(`Ligne « ${d.classe} » : classe introuvable en ${section} pour cette année.`);
      continue;
    }
    if (!bid) {
      errors.push(`Ligne « ${d.branche} » : branche introuvable.`);
      continue;
    }
    if (!tid) {
      errors.push(`Ligne « ${d.enseignant_email} » : enseignant introuvable.`);
      continue;
    }
    let sousId: string | null = null;
    if (d.sous_branche) {
      const match = (sousByBranch.get(bid) ?? []).find((s) => s.name === d.sous_branche);
      if (!match) {
        errors.push(`Ligne « ${d.sous_branche} » : sous-branche introuvable pour « ${d.branche} ».`);
        continue;
      }
      sousId = match.id;
    }

    const res = await createAttribution({
      school_year_id: yearId,
      section,
      classe_id: cid,
      branche_id: bid,
      sous_branche_ids: sousId ? [sousId] : [],
      enseignant_id: tid,
    });
    if (res.error) {
      errors.push(`${d.classe} / ${d.branche} : ${res.error}`);
    } else {
      created++;
    }
  }

  revalidatePath(`/${section}/attributions`);
  return { created, errors };
}

