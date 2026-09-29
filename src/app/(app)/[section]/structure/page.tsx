import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { StructureManager } from "@/components/structure/structure-manager";
import { RosterBlock } from "@/components/roster/roster-block";
import { orphanAssignments } from "@/lib/roster";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

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

  // Selected school year: the top-bar switcher cookie (same rule as the app
  // layout) — NOT always the active year. Falls back to the active year.
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, status");

  const selectedYear = (years ?? []).find((y: { id: string }) => y.id === cookieYear)
    ?? (years ?? []).find((y: { status: string }) => y.status === "active")
    ?? (years ?? [])[0];

  const yearId = selectedYear?.id;
  const yearLabel = selectedYear?.label ?? "";

  // Classes in this section+year, with titulaire name
  const { data: classes } = yearId
    ? await supabase
        .from("classes")
        .select("id, name, level, ordre, titulaire_id, section, school_year_id")
        .eq("section", section)
        .eq("school_year_id", yearId)
        .order("ordre")
    : { data: [] };

  // Teachers (role enseignant) in this section — for titulaire select.
  // Roster-filtered: only teachers active for the selected year are choosable.
  // No FK between user_roles and profiles, so fetch roles then names separately
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
  // Profiles for ALL role teachers (not just roster-active) so the roster
  // strip can name inactive teachers too.
  const allTeacherIds = [...new Set((teacherRoles ?? []).map((t: { user_id: string }) => t.user_id))];
  const { data: teacherProfiles } = allTeacherIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", allTeacherIds)
    : { data: [] };
  const teacherNameById = new Map((teacherProfiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));

  const teachers = activeTeacherRoles.map((t: { user_id: string }) => ({
    id: t.user_id,
    full_name: teacherNameById.get(t.user_id) ?? "—",
  }));

  // Titulaire lookup (all role teachers — a departed titulaire's name must
  // still display; only the dropdown stays roster-filtered)
  const titulaireById = new Map<string, string>();
  for (const t of (teacherRoles ?? [])) titulaireById.set(t.user_id, teacherNameById.get(t.user_id) ?? "—");

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

  // Roster strip data: entries + orphan count for this year+section.
  const { data: stripAttrs } = yearId
    ? await supabase
        .from("attributions")
        .select("enseignant_id, classe:classes!inner(section)")
        .eq("school_year_id", yearId)
    : { data: [] };
  const stripAttrCount = new Map<string, number>();
  for (const a of stripAttrs ?? []) {
    const cls = a.classe as unknown as { section: string };
    if (cls.section !== section) continue;
    stripAttrCount.set(a.enseignant_id, (stripAttrCount.get(a.enseignant_id) ?? 0) + 1);
  }
  const stripTitulCount = new Map<string, number>();
  for (const c of classes ?? []) {
    if (!c.titulaire_id) continue;
    stripTitulCount.set(c.titulaire_id, (stripTitulCount.get(c.titulaire_id) ?? 0) + 1);
  }
  const { data: stripFlags } = yearId
    ? await supabase
        .from("teacher_years")
        .select("user_id, is_active")
        .eq("school_year_id", yearId)
        .eq("section", section)
    : { data: [] };
  const stripFlagById = new Map(
    (stripFlags ?? []).map((r: { user_id: string; is_active: boolean }) => [r.user_id, r.is_active])
  );
  const stripEntries = (teacherRoles ?? []).map((t: { user_id: string }) => ({
    userId: t.user_id,
    name: teacherNameById.get(t.user_id) ?? "—",
    isActive: stripFlagById.get(t.user_id) ?? true,
    // « cours » = attributions only; titulaire de classe is shown separately.
    assignmentCount: stripAttrCount.get(t.user_id) ?? 0,
    titulaireCount: stripTitulCount.get(t.user_id) ?? 0,
    accountDisabled: false,
  }));
  const { attributionOrphans: stripAttrOrphans, titulaireOrphans: stripTitulOrphans } = yearId
    ? await orphanAssignments(supabase, yearId, section)
    : { attributionOrphans: [], titulaireOrphans: [] };
  const stripOrphanNames = [
    ...new Set([
      ...stripAttrOrphans.map((o) => o.teacherName),
      ...stripTitulOrphans.map((o) => o.teacherName),
    ]),
  ];

  return (
    <div className="space-y-4">
      {yearId && (
        <RosterBlock
          yearId={yearId}
          yearLabel={yearLabel}
          section={section}
          entries={stripEntries}
          orphanCount={stripAttrOrphans.length + stripTitulOrphans.length}
          orphanNames={stripOrphanNames}
          blocking={false}
          canToggle={canManage}
        />
      )}
      <StructureManager
      section={section}
      yearId={yearId ?? ""}
      yearLabel={yearLabel}
      classes={items}
      teachers={teachers}
      canManage={canManage}
      superAdmin={superAdmin}
    />
    </div>
  );
}
