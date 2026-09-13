import type { SupabaseClient } from "@supabase/supabase-js";
import type { Section } from "@/lib/auth";

/** Per-year teacher roster helpers (table `teacher_years`, migration 0013).
 *  Roster membership only — login rights and roles stay global (user_roles). */

type RosterSupabase = SupabaseClient;

/** Seed one active roster row per current enseignant role row for a new year.
 *  Idempotent (upsert on the PK) so retries after partial failure are safe. */
export async function seedRosterForYear(
  supabase: RosterSupabase,
  schoolYearId: string
): Promise<void> {
  const { data: roles, error: rolesErr } = await supabase
    .from("user_roles")
    .select("user_id, section")
    .eq("role", "enseignant")
    .in("section", ["primaire", "secondaire"]);
  if (rolesErr) throw new Error(rolesErr.message);

  const rows = (roles ?? []).map((r: { user_id: string; section: string }) => ({
    user_id: r.user_id,
    school_year_id: schoolYearId,
    section: r.section,
    is_active: true,
  }));
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("teacher_years")
    .upsert(rows, { onConflict: "user_id,school_year_id,section" });
  if (error) throw new Error(error.message);
}

/** Seed active roster rows for one teacher across the active + upcoming years.
 *  No years → no-op. Called when a teacher account is created. */
export async function seedRosterForUser(
  supabase: RosterSupabase,
  userId: string
): Promise<void> {
  const { data: roles, error: rolesErr } = await supabase
    .from("user_roles")
    .select("section")
    .eq("user_id", userId)
    .eq("role", "enseignant")
    .in("section", ["primaire", "secondaire"]);
  if (rolesErr) throw new Error(rolesErr.message);
  if (!roles || roles.length === 0) return;

  const { data: years, error: yearsErr } = await supabase
    .from("school_years")
    .select("id")
    .in("status", ["active", "upcoming"]);
  if (yearsErr) throw new Error(yearsErr.message);
  if (!years || years.length === 0) return;

  const rows = (roles as { section: string }[]).flatMap((r) =>
    (years as { id: string }[]).map((y) => ({
      user_id: userId,
      school_year_id: y.id,
      section: r.section,
      is_active: true,
    }))
  );

  const { error } = await supabase
    .from("teacher_years")
    .upsert(rows, { onConflict: "user_id,school_year_id,section" });
  if (error) throw new Error(error.message);
}

/** Activate / deactivate one teacher for one year+section (upsert). */
export async function setRosterActive(
  supabase: RosterSupabase,
  input: {
    userId: string;
    schoolYearId: string;
    section: Section;
    isActive: boolean;
  }
): Promise<void> {
  const { error } = await supabase.from("teacher_years").upsert(
    {
      user_id: input.userId,
      school_year_id: input.schoolYearId,
      section: input.section,
      is_active: input.isActive,
    },
    { onConflict: "user_id,school_year_id,section" }
  );
  if (error) throw new Error(error.message);
}

/** True when the teacher holds an active roster row for (year, section). */
export async function isRosterMember(
  supabase: RosterSupabase,
  input: { userId: string; schoolYearId: string; section: Section }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("teacher_years")
    .select("user_id")
    .eq("user_id", input.userId)
    .eq("school_year_id", input.schoolYearId)
    .eq("section", input.section)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

export type OrphanAssignments = {
  attributionOrphans: {
    id: string;
    classe: string;
    cours: string;
    teacherName: string;
  }[];
  titulaireOrphans: {
    classId: string;
    className: string;
    teacherName: string;
  }[];
};

/** Assignments in (year, section) pointing at teachers with no active roster
 *  row there. Read-only — callers decide whether to block or warn. */
export async function orphanAssignments(
  supabase: RosterSupabase,
  schoolYearId: string,
  section: Section
): Promise<OrphanAssignments> {
  const { data: roster, error: rosterErr } = await supabase
    .from("teacher_years")
    .select("user_id")
    .eq("school_year_id", schoolYearId)
    .eq("section", section)
    .eq("is_active", true);
  if (rosterErr) throw new Error(rosterErr.message);
  const activeIds = new Set(
    (roster ?? []).map((r: { user_id: string }) => r.user_id)
  );

  const { data: attrs, error: attrsErr } = await supabase
    .from("attributions")
    .select(
      "id, enseignant_id, classe:classes!inner(section, name), branche:branches(name)"
    )
    .eq("school_year_id", schoolYearId);
  if (attrsErr) throw new Error(attrsErr.message);

  const { data: classes, error: classesErr } = await supabase
    .from("classes")
    .select("id, name, titulaire_id")
    .eq("school_year_id", schoolYearId)
    .eq("section", section);
  if (classesErr) throw new Error(classesErr.message);

  const teacherIds = new Set<string>();
  for (const a of attrs ?? []) {
    const cls = a.classe as unknown as { section: string; name: string };
    if (cls.section !== section) continue;
    if (!activeIds.has(a.enseignant_id)) teacherIds.add(a.enseignant_id);
  }
  for (const c of classes ?? []) {
    if (c.titulaire_id && !activeIds.has(c.titulaire_id)) {
      teacherIds.add(c.titulaire_id);
    }
  }

  const nameOf = new Map<string, string>();
  if (teacherIds.size > 0) {
    const { data: profiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...teacherIds]);
    if (profilesErr) throw new Error(profilesErr.message);
    for (const p of profiles ?? []) {
      nameOf.set(p.id, p.full_name ?? "—");
    }
  }

  const attributionOrphans: OrphanAssignments["attributionOrphans"] = [];
  for (const a of attrs ?? []) {
    const cls = a.classe as unknown as { section: string; name: string };
    if (cls.section !== section) continue;
    if (activeIds.has(a.enseignant_id)) continue;
    const br = a.branche as unknown as { name: string } | null;
    attributionOrphans.push({
      id: a.id,
      classe: cls.name,
      cours: br?.name ?? "—",
      teacherName: nameOf.get(a.enseignant_id) ?? "—",
    });
  }

  const titulaireOrphans: OrphanAssignments["titulaireOrphans"] = [];
  for (const c of classes ?? []) {
    if (!c.titulaire_id || activeIds.has(c.titulaire_id)) continue;
    titulaireOrphans.push({
      classId: c.id,
      className: c.name,
      teacherName: nameOf.get(c.titulaire_id) ?? "—",
    });
  }

  return { attributionOrphans, titulaireOrphans };
}
