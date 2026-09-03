"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";

type Result = { error?: string };

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
