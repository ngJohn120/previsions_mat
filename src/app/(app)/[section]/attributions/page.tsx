import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { AttributionsManager } from "@/components/attributions/attributions-manager";

export const dynamic = "force-dynamic";

export default async function AttributionsPage({
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

  const { data: activeYear } = await supabase
    .from("school_years")
    .select("id, label")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const yearId = activeYear?.id ?? "";

  // Attributions with fiche statut
  const { data: attrs } = yearId
    ? await supabase
        .from("attributions")
        .select("id, classe_id, branche_id, sous_branche_id, enseignant_id")
        .eq("school_year_id", yearId)
    : { data: [] };

  // Lookups: classes, branches, sous_branches, fiches statut, profiles
  const { data: classes } = await supabase.from("classes").select("id, name, section").eq("school_year_id", yearId);
  const { data: branches } = await supabase.from("branches").select("id, name");
  const { data: sous } = await supabase.from("sous_branches").select("id, name, branche_id");
  const { data: fiches } = await supabase.from("fiches").select("id, attribution_id, statut");
  const { data: teacherRoles } = await supabase
    .from("user_roles")
    .select("user_id, role, section, profile:profiles!inner(full_name)")
    .eq("role", "enseignant")
    .eq("section", section);

  const classById = new Map((classes ?? []).map((c: any) => [c.id, c]));
  const branchById = new Map((branches ?? []).map((b: any) => [b.id, b.name]));
  const sousById = new Map((sous ?? []).map((s: any) => [s.id, s.name]));
  const ficheByAttr = new Map((fiches ?? []).map((f: any) => [f.attribution_id, f.statut]));
  const teacherById = new Map((teacherRoles ?? []).map((t: any) => [t.user_id, t.profile?.full_name ?? "—"]));

  const items = (attrs ?? []).map((a: any) => ({
    id: a.id,
    classe: classById.get(a.classe_id)?.name ?? "—",
    classe_section: classById.get(a.classe_id)?.section ?? section,
    branche: branchById.get(a.branche_id) ?? "—",
    sous_branche: a.sous_branche_id ? sousById.get(a.sous_branche_id) ?? "—" : null,
    enseignant: teacherById.get(a.enseignant_id) ?? "—",
    statut: ficheByAttr.get(a.id) ?? null, // null = no fiche yet
  }));

  // Options for dialog
  const classOptions = (classes ?? []).filter((c: any) => c.section === section).map((c: any) => ({ id: c.id, name: c.name }));
  const branchOptions = (branches ?? []).filter((b: any) => (b.sections ?? []).includes(section)).map((b: any) => ({ id: b.id, name: b.name }));
  const sousOptions = (sous ?? []).filter((s: any) => branchOptions.some((b: any) => b.id === s.branche_id)).map((s: any) => ({ id: s.id, name: s.name, branche_id: s.branche_id }));
  const teacherOptions = (teacherRoles ?? []).map((t: any) => ({ id: t.user_id, full_name: t.profile?.full_name ?? "—" }));

  return (
    <AttributionsManager
      section={section}
      yearId={yearId}
      yearLabel={activeYear?.label ?? ""}
      items={items}
      classOptions={classOptions}
      branchOptions={branchOptions}
      sousOptions={sousOptions}
      teacherOptions={teacherOptions}
      canManage={canManage}
      superAdmin={superAdmin}
    />
  );
}
