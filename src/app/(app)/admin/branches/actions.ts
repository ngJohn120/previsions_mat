"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin, type Section } from "@/lib/auth";
import { validateBranchesCsv, type CsvRow } from "@/lib/csv";

type Result = { error?: string };
export type ImportResult = { created: number; errors: string[] };

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

export async function createBranche(input: {
  name: string;
  sections: ("primaire" | "secondaire")[];
  sous_branches?: string[];
}): Promise<Result> {
  const access = await requireBranchesAccess();
  if (!access) return { error: "Accès refusé." };
  if (!input.name.trim()) return { error: "Le nom de la branche est obligatoire." };
  const sections = clampSections(input.sections as string[], access.scope);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .insert({ name: input.name.trim(), sections })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Sous-branches
  for (const sb of input.sous_branches ?? []) {
    if (!sb.trim()) continue;
    const { error: sbErr } = await supabase
      .from("sous_branches")
      .insert({ branche_id: data.id, name: sb.trim() });
    if (sbErr) return { error: `Sous-branche : ${sbErr.message}` };
  }

  revalidatePath("/admin/branches");
  return {};
}

export async function updateBranche(input: {
  id: string;
  name: string;
  sections: ("primaire" | "secondaire")[];
  sous_branches: string[]; // full list of names to replace
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

  // Final sections = whatever the branch already had OUTSIDE this admin's scope
  // (a shared branch stays shared) + the in-scope sections they're submitting.
  const keptOutside = existingSections.filter((s) => !access.scope.includes(s));
  const changedInside = clampSections(input.sections as string[], access.scope);
  const sections = Array.from(new Set([...keptOutside, ...changedInside]));
  const { error } = await supabase
    .from("branches")
    .update({ name: input.name.trim(), sections })
    .eq("id", input.id);
  if (error) return { error: error.message };

  // Replace sous-branches: delete existing then re-insert (simple; in-use ones will warn at DB level)
  const { data: existing } = await supabase.from("sous_branches").select("id").eq("branche_id", input.id);
  for (const e of existing ?? []) {
    // If a sous-branche is referenced by attributions, delete will fail via FK restrict? (set null) — we allow set null
    await supabase.from("sous_branches").delete().eq("id", e.id);
  }
  for (const sb of input.sous_branches) {
    if (!sb.trim()) continue;
    await supabase.from("sous_branches").insert({ branche_id: input.id, name: sb.trim() });
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
