import { redirect } from "next/navigation";
import { getSessionUser, isSuperAdmin, adminSections, type Section } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { orphanAssignments } from "@/lib/roster";
import { RevisionView, type RevisionData } from "@/components/revision/revision-view";

export const dynamic = "force-dynamic";

/** Révision de la nouvelle année — section admins validate their section's
 *  cloned structure; super admin watches and activates once both validated. */
export default async function RevisionPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const superAdmin = isSuperAdmin(user.roles);
  const sections = adminSections(user.roles);
  if (!superAdmin && sections.length === 0) redirect("/");

  const supabase = await createClient();

  // The upcoming year being prepared (next by start date).
  const { data: year } = await supabase
    .from("school_years")
    .select("id, label, start_date, end_date")
    .eq("status", "upcoming")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  let validations: RevisionData["validations"] = [];
  let attributions: RevisionData["attributions"] = [];
  const roster: RevisionData["roster"] = { primaire: [], secondaire: [] };
  const orphans: RevisionData["orphans"] = {
    primaire: { attributionOrphans: [], titulaireOrphans: [] },
    secondaire: { attributionOrphans: [], titulaireOrphans: [] },
  };
  let currentYearLabel = "active";

  const { data: activeYear } = await supabase
    .from("school_years")
    .select("id, label")
    .eq("status", "active")
    .maybeSingle();
  currentYearLabel = activeYear?.label ?? "active";

  if (year) {
    const { data: valRows } = await supabase
      .from("year_section_validations")
      .select("section, validated_by, validated_at")
      .eq("school_year_id", year.id);

    const validatorIds = [...new Set((valRows ?? []).map((v) => v.validated_by))];
    const { data: validatorProfiles } = validatorIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", validatorIds)
      : { data: [] as { id: string; full_name: string | null }[] };
    const nameOf = new Map((validatorProfiles ?? []).map((p) => [p.id, p.full_name ?? "—"]));

    validations = (valRows ?? []).map((v) => ({
      section: v.section as Section,
      validatedByName: nameOf.get(v.validated_by) ?? "—",
      validatedAt: v.validated_at as string,
    }));

    // Attributions of the year per section (classes/branches/teachers names).
    const { data: attrs } = await supabase
      .from("attributions")
      .select("id, enseignant_id, classe:classes!inner(section, name), branche:branches(name), sous:sous_branches(name)")
      .eq("school_year_id", year.id);

    const teacherIds = [...new Set((attrs ?? []).map((a) => a.enseignant_id))];
    const { data: teacherProfiles } = teacherIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", teacherIds)
      : { data: [] as { id: string; full_name: string | null }[] };
    const teacherName = new Map((teacherProfiles ?? []).map((p) => [p.id, p.full_name ?? "—"]));

    attributions = (attrs ?? []).map((a) => {
      const cls = a.classe as unknown as { section: string; name: string };
      const br = a.branche as unknown as { name: string } | null;
      const sb = a.sous as unknown as { name: string } | null;
      return {
        id: a.id,
        section: cls.section as Section,
        classe: cls.name,
        cours: br?.name ?? "—",
        sousBranche: sb?.name ?? null,
        enseignant: teacherName.get(a.enseignant_id) ?? "—",
      };
    });

    // Roster per section: every enseignant role row, with the year's active
    // flag (missing row = active — seeding covers all current teachers) plus
    // assignment counts (attributions + titular classes) for this year.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, section")
      .eq("role", "enseignant")
      .in("section", ["primaire", "secondaire"]);
    const { data: rosterRows } = await supabase
      .from("teacher_years")
      .select("user_id, section, is_active")
      .eq("school_year_id", year.id);
    const flagByKey = new Map(
      (rosterRows ?? []).map((r: { user_id: string; section: string; is_active: boolean }) => [
        `${r.user_id}:${r.section}`,
        r.is_active,
      ])
    );
    const rosterNameIds = [...new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id))];
    const { data: rosterProfiles } = rosterNameIds.length
      ? await supabase.from("profiles").select("id, full_name, disabled").in("id", rosterNameIds)
      : { data: [] as { id: string; full_name: string | null; disabled: boolean }[] };
    const rosterNameOf = new Map(
      (rosterProfiles ?? []).map((p) => [p.id as string, { name: (p.full_name ?? "—") as string, disabled: (p.disabled ?? false) as boolean }])
    );

    const { data: yearClasses } = await supabase
      .from("classes")
      .select("id, section, titulaire_id")
      .eq("school_year_id", year.id);
    for (const s of ["primaire", "secondaire"] as Section[]) {
      const attrCount = new Map<string, number>();
      for (const a of attrs ?? []) {
        const cls = a.classe as unknown as { section: string };
        if (cls.section !== s) continue;
        attrCount.set(a.enseignant_id, (attrCount.get(a.enseignant_id) ?? 0) + 1);
      }
      const titulCount = new Map<string, number>();
      for (const c of yearClasses ?? []) {
        if (c.section !== s || !c.titulaire_id) continue;
        titulCount.set(c.titulaire_id, (titulCount.get(c.titulaire_id) ?? 0) + 1);
      }
      roster[s] = (roleRows ?? [])
        .filter((r: { section: string }) => r.section === s)
        .map((r: { user_id: string }) => ({
          userId: r.user_id,
          name: rosterNameOf.get(r.user_id)?.name ?? "—",
          isActive: flagByKey.get(`${r.user_id}:${s}`) ?? true,
          assignmentCount:
            (attrCount.get(r.user_id) ?? 0) + (titulCount.get(r.user_id) ?? 0),
          accountDisabled: rosterNameOf.get(r.user_id)?.disabled ?? false,
        }))
        .sort((x, y) => x.name.localeCompare(y.name, "fr"));

      orphans[s] = await orphanAssignments(supabase, year.id, s);
    }
  }

  return (
    <RevisionView
      year={year ? { id: year.id, label: year.label, start_date: year.start_date, end_date: year.end_date } : null}
      viewerIsSuper={superAdmin}
      viewerSections={sections}
      currentYearLabel={currentYearLabel}
      validations={validations}
      attributions={attributions}
      roster={roster}
      orphans={orphans}
    />
  );
}
