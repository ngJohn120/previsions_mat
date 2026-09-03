"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { validateBranchesCsv, type CsvRow } from "@/lib/csv";

type Result = { error?: string };
export type ImportResult = { created: number; errors: string[] };

async function requireBranchesAccess() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const can = isSuperAdmin(user.roles) || isSectionAdmin(user.roles, "primaire") || isSectionAdmin(user.roles, "secondaire");
  if (!can) redirect("/");
  return user;
}

export async function createBranche(input: {
  name: string;
  sections: ("primaire" | "secondaire")[];
  sous_branches?: string[];
}): Promise<Result> {
  await requireBranchesAccess();
  if (!input.name.trim()) return { error: "Le nom de la branche est obligatoire." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .insert({ name: input.name.trim(), sections: input.sections.length ? input.sections : ["primaire", "secondaire"] })
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
  await requireBranchesAccess();
  const supabase = await createClient();

  const { error } = await supabase
    .from("branches")
    .update({ name: input.name.trim(), sections: input.sections.length ? input.sections : ["primaire", "secondaire"] })
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
  await requireBranchesAccess();
  const supabase = await createClient();
  const { error } = await supabase.from("branches").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/branches");
  return {};
}

export async function importBranchesCsv(rows: CsvRow[]): Promise<ImportResult> {
  await requireBranchesAccess();
  const supabase = await createClient();
  const { data, errors: validation } = validateBranchesCsv(rows);
  const errors = validation.map((v) => `Ligne ${v.line} : ${v.message}`);
  let created = 0;

  for (const b of data) {
    const { data: branch, error } = await supabase
      .from("branches")
      .insert({
        name: b.name,
        sections: b.sections as ("primaire" | "secondaire")[],
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
