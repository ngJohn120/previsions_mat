import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { StructureManager } from "@/components/structure/structure-manager";

export const dynamic = "force-dynamic";

export default async function StructurePage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section !== "primaire" && section !== "secondaire") notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const superAdmin = isSuperAdmin(user.roles);
  const canManage = superAdmin || isSectionAdmin(user.roles, section);
  if (!canManage) redirect("/");

  const supabase = await createClient();

  // Active school year (first active, else first year)
  const { data: activeYear } = await supabase
    .from("school_years")
    .select("id, label")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const yearId = activeYear?.id;
  const yearLabel = activeYear?.label ?? "";

  // Classes in this section+year, with titulaire name
  const { data: classes } = yearId
    ? await supabase
        .from("classes")
        .select("id, name, level, ordre, titulaire_id, section, school_year_id")
        .eq("section", section)
        .eq("school_year_id", yearId)
        .order("ordre")
    : { data: [] };

  // Teachers (role enseignant) in this section — for titulaire select
  // No FK between user_roles and profiles, so fetch roles then names separately
  const { data: teacherRoles } = await supabase
    .from("user_roles")
    .select("user_id, role, section")
    .eq("role", "enseignant")
    .eq("section", section);
  const teacherIds = [...new Set((teacherRoles ?? []).map((t: { user_id: string }) => t.user_id))];
  const { data: teacherProfiles } = teacherIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
    : { data: [] };
  const teacherNameById = new Map((teacherProfiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));

  const teachers = (teacherRoles ?? []).map((t: { user_id: string }) => ({
    id: t.user_id,
    full_name: teacherNameById.get(t.user_id) ?? "—",
  }));

  // Titulaire lookup
  const titulaireById = new Map<string, string>();
  for (const t of teachers) titulaireById.set(t.id, t.full_name);

  const classItems = (classes ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    ordre: c.ordre,
    titulaire_id: c.titulaire_id,
    titulaire_name: c.titulaire_id ? titulaireById.get(c.titulaire_id) ?? "—" : null,
  }));

  // Course count per class = number of attributions in that class
  const { data: attrCounts } = yearId
    ? await supabase
        .from("attributions")
        .select("classe_id")
        .eq("school_year_id", yearId)
    : { data: [] };
  const countByClass = new Map<string, number>();
  for (const a of attrCounts ?? []) {
    countByClass.set(a.classe_id, (countByClass.get(a.classe_id) ?? 0) + 1);
  }
  const items = classItems.map((c) => ({
    ...c,
    cours_count: countByClass.get(c.id) ?? 0,
  }));

  return (
    <StructureManager
      section={section}
      yearId={yearId ?? ""}
      yearLabel={yearLabel}
      classes={items}
      teachers={teachers}
      canManage={canManage}
      superAdmin={superAdmin}
    />
  );
}
