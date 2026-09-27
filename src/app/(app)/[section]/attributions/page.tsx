import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { AttributionsManager } from "@/components/attributions/attributions-manager";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

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

  // Selected school year: the top-bar switcher cookie (same rule as the app
  // layout and the Structure page) — NOT always the active year.
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, status");

  const selectedYear = (years ?? []).find((y: { id: string }) => y.id === cookieYear)
    ?? (years ?? []).find((y: { status: string }) => y.status === "active")
    ?? (years ?? [])[0];

  const yearId = selectedYear?.id ?? "";

  // Attributions with fiche statut
  const { data: attrs } = yearId
    ? await supabase
        .from("attributions")
        .select("id, classe_id, branche_id, sous_branche_id, enseignant_id")
        .eq("school_year_id", yearId)
    : { data: [] };

  // Lookups: classes, branches, sous_branches, fiches statut, profiles
  const { data: classes } = await supabase.from("classes").select("id, name, section").eq("school_year_id", yearId);
  const { data: branches } = await supabase.from("branches").select("id, name, sections");
  const { data: sous } = await supabase
    .from("sous_branches")
    .select("id, name, branche_id, classe_id");
  const { data: fiches } = await supabase.from("fiches").select("id, attribution_id, statut");
  // No FK between user_roles and profiles, so fetch roles then names separately.
  // Roster-filtered: only teachers active for the selected year are choosable.
  const { data: teacherRoles } = await supabase
    .from("user_roles")
    .select("user_id, role, section")
    .eq("role", "enseignant")
    .eq("section", section);
  const { data: roster } = yearId
    ? await supabase
        .from("teacher_years")
        .select("user_id")
        .eq("school_year_id", yearId)
        .eq("section", section)
        .eq("is_active", true)
    : { data: [] };
  const rosterIds = new Set((roster ?? []).map((r: { user_id: string }) => r.user_id));
  const activeTeacherRoles = (teacherRoles ?? []).filter((t: { user_id: string }) => rosterIds.has(t.user_id));
  // Orphan attribution ids (teacher off this year's roster) — highlighted in
  // the table so they can be found and reassigned. Empty when no year.
  const orphanAttrIds = yearId
    ? (attrs ?? []).filter((a: { enseignant_id: string }) => !rosterIds.has(a.enseignant_id)).map((a: { id: string }) => a.id)
    : [];
  // Profiles for ALL role teachers: display lookups must still name teachers
  // who left the roster (orphaned rows), only the dropdown stays filtered.
  const allTeacherIds = [...new Set((teacherRoles ?? []).map((t: { user_id: string }) => t.user_id))];
  const { data: teacherProfiles } = allTeacherIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", allTeacherIds)
    : { data: [] };
  const teacherNameById = new Map((teacherProfiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));

  const classById = new Map((classes ?? []).map((c: any) => [c.id, c]));
  const branchById = new Map((branches ?? []).map((b: any) => [b.id, b.name]));
  const sousById = new Map((sous ?? []).map((s: any) => [s.id, s.name]));
  const ficheByAttr = new Map((fiches ?? []).map((f: any) => [f.attribution_id, f.statut]));
  const teacherById = new Map((teacherRoles ?? []).map((t: { user_id: string }) => [t.user_id, teacherNameById.get(t.user_id) ?? "—"]));

  const items = (attrs ?? [])
    // Scope to the page's section: RLS already hides the other section from
    // section admins, but a super admin may read both — this table must only
    // list the section it is titled for.
    .filter((a: { classe_id: string }) => (classById.get(a.classe_id)?.section ?? section) === section)
    .map((a: any) => ({
      id: a.id,
      classe_id: a.classe_id,
      branche_id: a.branche_id,
      sous_branche_id: a.sous_branche_id,
      classe: classById.get(a.classe_id)?.name ?? "—",
      classe_section: classById.get(a.classe_id)?.section ?? section,
      // A branch-less subject (0017) has no parent: the sous-branche IS the
      // cours, so display its name (the column already reads « Cours »).
      branche: (a.branche_id ? branchById.get(a.branche_id) : null) ?? (a.sous_branche_id ? sousById.get(a.sous_branche_id) : null) ?? "—",
      // A branch-less subject (0017) is stored as its own sous-branche, but it
      // IS the cours — showing it twice would be noise.
      sous_branche: a.branche_id ? (a.sous_branche_id ? sousById.get(a.sous_branche_id) ?? "—" : null) : null,
      enseignant: teacherById.get(a.enseignant_id) ?? "—",
      statut: ficheByAttr.get(a.id) ?? null, // null = no fiche yet
    }));

  // Options for dialog
  const classOptions = (classes ?? []).filter((c: any) => c.section === section).map((c: any) => ({ id: c.id, name: c.name }));
  const branchOptions = (branches ?? []).filter((b: any) => (b.sections ?? []).includes(section)).map((b: any) => ({ id: b.id, name: b.name }));
  // `classe_id` travels with each sous-branche so the dialog can offer only the
  // ones that exist for the selected class (NULL = partagée, all classes).
  const sousOptions = (sous ?? [])
    .map((s: any) => ({ id: s.id, name: s.name, branche_id: s.branche_id ?? null, classe_id: s.classe_id ?? null }));
  // Subjects with NO parent branch (0017). One entry PER storage row (the same
  // subject can exist for several classes); the dialog shows one checkbox per
  // class and scopes them by the selected class.
  const orphanSubjects = sousOptions.filter((s: any) => !s.branche_id);
  const teacherOptions = activeTeacherRoles.map((t: { user_id: string }) => ({ id: t.user_id, full_name: teacherNameById.get(t.user_id) ?? "—" }));

  return (
    <AttributionsManager
      section={section}
      yearId={yearId}
      yearLabel={selectedYear?.label ?? ""}
      items={items}
      classOptions={classOptions}
      branchOptions={branchOptions}
      orphanSubjects={orphanSubjects}
      sousOptions={sousOptions}
      teacherOptions={teacherOptions}
      orphanAttrIds={orphanAttrIds}
      canManage={canManage}
      superAdmin={superAdmin}
    />
  );
}
