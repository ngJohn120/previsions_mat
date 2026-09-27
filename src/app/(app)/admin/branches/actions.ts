"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin, type Section } from "@/lib/auth";
import { validateBranchesCsv, type CsvRow } from "@/lib/csv";

type Result = { error?: string };
export type ImportResult = { created: number; errors: string[] };

/** Sous-branche payload from the manager — `id` present = existing row (keep its identity). */
export type SousBranchePayload = { id?: string; name: string; classe_id: string | null };

/** Normalize + validate the class links a save carries (branch itself and its sous-branches). */
async function validateClassLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classeIds: (string | null)[]
): Promise<string | null> {
  const unique = [...new Set(classeIds.filter(Boolean))] as string[];
  if (!unique.length) return null;
  const { data } = await supabase.from("classes").select("id, section").in("id", unique);
  const byId = new Map((data ?? []).map((c: { id: string; section: string }) => [c.id, c.section]));
  for (const id of unique) {
    if (!byId.has(id)) return "Classe introuvable.";
    if (byId.get(id) !== "primaire") return "Une branche ou sous-branche ne peut être liée qu'à une classe du primaire.";
  }
  return null;
}

/** Sections the current user may manage (super → both, section admin → own). */
async function manageableSections(): Promise<Section[] | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const superAdmin = isSuperAdmin(user.roles);
  const scope: Section[] = superAdmin
    ? ["primaire", "secondaire"]
    : [
        ...(isSectionAdmin(user.roles, "primaire") ? ["primaire" as Section] : []),
        ...(isSectionAdmin(user.roles, "secondaire") ? ["secondaire" as Section] : []),
      ];
  return scope.length ? scope : null;
}

/** Clamp requested sections to those the current admin may manage. */
function clampSections(sections: string[], scope: Section[]): Section[] {
  const wanted = sections.length ? sections : scope; // empty => "both" historically
  const kept = (["primaire", "secondaire"] as Section[]).filter(
    (s) => scope.includes(s) && wanted.includes(s)
  );
  // Ensure at least one section survives for section admins
  return kept.length ? kept : [...scope];
}

async function requireBranchesAccess(): Promise<{ scope: Section[] } | null> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const scope = await manageableSections();
  if (!scope) redirect("/");
  return { scope };
}

function friendlySousError(name: string, error: { code?: string; message: string }): string {
  if (error.code === "23505") return `Sous-branche « ${name} » : ce nom existe déjà pour cette classe.`;
  return `Sous-branche « ${name} » : ${error.message}`;
}

export async function createBranche(input: {
  name: string;
  sections: ("primaire" | "secondaire")[];
  classe_id?: string | null;
  sous_branches?: SousBranchePayload[];
}): Promise<Result> {
  const access = await requireBranchesAccess();
  if (!access) return { error: "Accès refusé." };
  if (!input.name.trim()) return { error: "Le nom de la branche est obligatoire." };
  const sections = clampSections(input.sections as string[], access.scope);
  const supabase = await createClient();

  const rows = (input.sous_branches ?? [])
    .map((r) => ({ name: r.name.trim(), classe_id: r.classe_id || null }))
    .filter((r) => r.name);
  const branchClasse = input.classe_id || null;
  const classErr = await validateClassLinks(supabase, [branchClasse, ...rows.map((r) => r.classe_id)]);
  if (classErr) return { error: classErr };

  const { data, error } = await supabase
    .from("branches")
    .insert({ name: input.name.trim(), sections, classe_id: branchClasse })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Sous-branches
  for (const r of rows) {
    const { error: sbErr } = await supabase
      .from("sous_branches")
      .insert({ branche_id: data.id, name: r.name, classe_id: r.classe_id });
    if (sbErr) return { error: friendlySousError(r.name, sbErr) };
  }

  revalidatePath("/admin/branches");
  return {};
}

export async function updateBranche(input: {
  id: string;
  name: string;
  sections: ("primaire" | "secondaire")[];
  classe_id?: string | null;
  sous_branches: SousBranchePayload[]; // full list; id present = existing row to keep
}): Promise<Result> {
  const access = await requireBranchesAccess();
  if (!access) return { error: "Accès refusé." };
  const supabase = await createClient();

  // Section admins may only edit branches that belong to their own section(s).
  const { data: existingRow } = await supabase
    .from("branches")
    .select("sections")
    .eq("id", input.id)
    .single();
  const existingSections: Section[] = (existingRow?.sections ?? []) as Section[];
  if (existingRow && !existingSections.some((s) => access.scope.includes(s))) {
    return { error: "Cette branche ne fait pas partie de votre section." };
  }

  const rows = input.sous_branches
    .map((r) => ({ id: r.id ?? null, name: r.name.trim(), classe_id: r.classe_id || null }))
    .filter((r) => r.name);
  const branchClasse = input.classe_id || null;
  const classErr = await validateClassLinks(supabase, [branchClasse, ...rows.map((r) => r.classe_id)]);
  if (classErr) return { error: classErr };

  // Final sections = whatever the branch already had OUTSIDE this admin's scope
  // (a shared branch stays shared) + the in-scope sections they're submitting.
  const keptOutside = existingSections.filter((s) => !access.scope.includes(s));
  const changedInside = clampSections(input.sections as string[], access.scope);
  const sections = Array.from(new Set([...keptOutside, ...changedInside]));
  const { error } = await supabase
    .from("branches")
    .update({ name: input.name.trim(), sections, classe_id: branchClasse })
    .eq("id", input.id);
  if (error) return { error: error.message };

  // Diff instead of wipe-and-reinsert: a row that keeps its id keeps its
  // identity (attributions referencing it are not reset), a changed name or
  // classe is an UPDATE, only actually-removed rows are deleted.
  const { data: existing } = await supabase
    .from("sous_branches")
    .select("id, name, classe_id")
    .eq("branche_id", input.id);
  const existingById = new Map(
    (existing ?? []).map((e: { id: string; name: string; classe_id: string | null }) => [e.id, e])
  );
  const keptIds = new Set(rows.map((r) => r.id).filter(Boolean) as string[]);
  for (const e of existing ?? []) {
    if (!keptIds.has(e.id)) {
      await supabase.from("sous_branches").delete().eq("id", e.id);
    }
  }
  for (const r of rows) {
    const prev = r.id ? existingById.get(r.id) : undefined;
    if (r.id && prev) {
      if (prev.name !== r.name || (prev.classe_id ?? null) !== r.classe_id) {
        const { error: sbErr } = await supabase
          .from("sous_branches")
          .update({ name: r.name, classe_id: r.classe_id })
          .eq("id", r.id);
        if (sbErr) return { error: friendlySousError(r.name, sbErr) };
      }
    } else {
      const { error: sbErr } = await supabase
        .from("sous_branches")
        .insert({ branche_id: input.id, name: r.name, classe_id: r.classe_id });
      if (sbErr) return { error: friendlySousError(r.name, sbErr) };
    }
  }

  revalidatePath("/admin/branches");
  return {};
}

export async function deleteBranche(id: string): Promise<Result> {
  const access = await requireBranchesAccess();
  if (!access) return { error: "Accès refusé." };
  const supabase = await createClient();
  const { data: existingRow } = await supabase
    .from("branches")
    .select("sections")
    .eq("id", id)
    .single();
  const existingSections: Section[] = (existingRow?.sections ?? []) as Section[];
  if (existingRow && !existingSections.some((s) => access.scope.includes(s))) {
    return { error: "Cette branche ne fait pas partie de votre section." };
  }
  const { error } = await supabase.from("branches").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/branches");
  return {};
}

export async function importBranchesCsv(rows: CsvRow[]): Promise<ImportResult> {
  const access = await requireBranchesAccess();
  if (!access) return { created: 0, errors: ["Accès refusé."] };
  const supabase = await createClient();
  const { data, errors: validation } = validateBranchesCsv(rows);
  const errors = validation.map((v) => `Ligne ${v.line} : ${v.message}`);
  let created = 0;

  for (const b of data) {
    const sections = clampSections(b.sections, access.scope);
    const { data: branch, error } = await supabase
      .from("branches")
      .insert({
        name: b.name,
        sections,
      })
      .select("id")
      .single();
    if (error || !branch) {
      errors.push(`${b.name} : ${error?.message ?? "erreur"}`);
      continue;
    }
    for (const sb of b.sous_branches) {
      const { error: sbErr } = await supabase
        .from("sous_branches")
        .insert({ branche_id: branch.id, name: sb });
      if (sbErr) errors.push(`${b.name} / ${sb} : ${sbErr.message}`);
    }
    created++;
  }

  revalidatePath("/admin/branches");
  return { created, errors };
}
