"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { validateClassesCsv, type CsvRow } from "@/lib/csv";

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
