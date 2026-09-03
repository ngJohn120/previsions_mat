import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { RolloverWizard } from "@/components/rollover/rollover-wizard";

export const dynamic = "force-dynamic";

export default async function AnneePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");

  const supabase = await createClient();
  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, start_date, end_date, status")
    .order("start_date", { ascending: false });

  const { data: classes } = await supabase.from("classes").select("id, name, section, school_year_id");
  const { data: attrs } = await supabase.from("attributions").select("id, school_year_id, classe_id, branche_id, sous_branche_id, enseignant_id");
  const { data: teachers } = await supabase
    .from("user_roles")
    .select("user_id, full_name:profiles!inner(full_name), section")
    .eq("role", "enseignant");
  const { data: branches } = await supabase.from("branches").select("id, name");
  const { data: sous } = await supabase.from("sous_branches").select("id, name");

  const branchName = new Map((branches ?? []).map((b: any) => [b.id, b.name]));
  const sousName = new Map((sous ?? []).map((s: any) => [s.id, s.name]));
  const teacherName = new Map((teachers ?? []).map((t: any) => [t.user_id, t.full_name]));
  const className = new Map((classes ?? []).map((c: any) => [c.id, c.name]));

  // Per-year summary + attribute detail for the latest year
  const yearSummaries = (years ?? []).map((y: any) => {
    const yearClasses = (classes ?? []).filter((c: any) => c.school_year_id === y.id);
    const yearAttrs = (attrs ?? []).filter((a: any) => a.school_year_id === y.id);
    return {
      id: y.id,
      label: y.label,
      start_date: y.start_date,
      end_date: y.end_date,
      status: y.status,
      class_count: yearClasses.length,
      attr_count: yearAttrs.length,
    };
  });

  const activeYear = yearSummaries.find((y) => y.status === "active");
  const latestYear = yearSummaries[0] ?? null;

  // Attribute rows for the source year (active or latest) to show in clone preview
  const srcYear = activeYear ?? latestYear;
  const attrRows = srcYear
    ? (attrs ?? [])
        .filter((a: any) => a.school_year_id === srcYear.id)
        .map((a: any) => ({
          id: a.id,
          classe: className.get(a.classe_id) ?? "—",
          branche: branchName.get(a.branche_id) ?? "—",
          sous_branche: a.sous_branche_id ? sousName.get(a.sous_branche_id) ?? "—" : null,
          enseignant: teacherName.get(a.enseignant_id) ?? "—",
        }))
    : [];

  return (
    <RolloverWizard
      years={yearSummaries}
      activeYearId={activeYear?.id ?? null}
      sourceYear={srcYear ?? null}
      sourceAttrs={attrRows}
    />
  );
}
