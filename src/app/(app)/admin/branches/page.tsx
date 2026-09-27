import { getSessionUser, isSuperAdmin, isSectionAdmin, type Section } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { BranchesManager } from "@/components/branches/branches-manager";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

export default async function BranchesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const superAdmin = isSuperAdmin(user.roles);
  const canManage = superAdmin || isSectionAdmin(user.roles, "primaire") || isSectionAdmin(user.roles, "secondaire");
  if (!canManage) redirect("/");

  // Sections this admin may see/manage. Super admin: both. Section admin: own section only.
  const scope: Section[] = superAdmin
    ? ["primaire", "secondaire"]
    : [
        ...(isSectionAdmin(user.roles, "primaire") ? ["primaire" as Section] : []),
        ...(isSectionAdmin(user.roles, "secondaire") ? ["secondaire" as Section] : []),
      ];

  const supabase = await createClient();

  // Selected school year — same rule as the layout / Structure / Attributions:
  // top-bar switcher cookie, else the active year, else the first one.
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;
  const { data: years } = await supabase.from("school_years").select("id, label, status");
  const selectedYear =
    (years ?? []).find((y: { id: string }) => y.id === cookieYear) ??
    (years ?? []).find((y: { status: string }) => y.status === "active") ??
    (years ?? [])[0] ?? null;

  const { data: branches } = await supabase.from("branches").select("id, name, sections").order("name");
  const { data: sous } = await supabase.from("sous_branches").select("id, branche_id, name, classe_id").order("name");

  // « Classe » choices for the sous-branches modal: primaire classes of the
  // selected year. Sous-branches may also point at classes from other years —
  // keep their names so the table and the edit select never lose a binding.
  const { data: yearClasses } = selectedYear
    ? await supabase
        .from("classes")
        .select("id, name, section, ordre")
        .eq("school_year_id", selectedYear.id)
        .eq("section", "primaire")
        .order("ordre")
        .order("name")
    : { data: [] };
  const boundIds = [...new Set((sous ?? []).map((s: { classe_id: string | null }) => s.classe_id).filter(Boolean))] as string[];
  const knownIds = new Set((yearClasses ?? []).map((c: { id: string }) => c.id));
  const missingIds = boundIds.filter((id) => !knownIds.has(id));
  const { data: extraClasses } = missingIds.length
    ? await supabase.from("classes").select("id, name").in("id", missingIds)
    : { data: [] };
  const classeNameById = new Map<string, string>(
    [...(yearClasses ?? []), ...(extraClasses ?? [])].map((c: { id: string; name: string }) => [c.id, c.name])
  );
  const classOptions = [...(yearClasses ?? []), ...(extraClasses ?? [])].map((c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
  }));

  const sbByBranch = new Map<string, { id: string; name: string; classe_id: string | null; classe: string | null }[]>();
  for (const s of sous ?? []) {
    const arr = sbByBranch.get(s.branche_id) ?? [];
    arr.push({
      id: s.id,
      name: s.name,
      classe_id: s.classe_id ?? null,
      classe: s.classe_id ? classeNameById.get(s.classe_id) ?? "—" : null,
    });
    sbByBranch.set(s.branche_id, arr);
  }

  const inScope = (sections: string[]) => sections.some((s) => (scope as string[]).includes(s));
  const items = (branches ?? [])
    .filter((b: { sections: string[] | null }) => inScope(b.sections ?? []))
    .map((b: { id: string; name: string; sections: string[] | null }) => ({
      id: b.id,
      name: b.name,
      sections: (b.sections ?? []) as string[],
      sous_branches: sbByBranch.get(b.id) ?? [],
    }));

  return (
    <BranchesManager
      branches={items}
      canManage={canManage}
      scope={scope}
      classOptions={classOptions}
      yearLabel={selectedYear?.label ?? ""}
    />
  );
}
