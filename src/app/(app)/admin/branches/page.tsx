import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BranchesManager } from "@/components/branches/branches-manager";

export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const canManage = isSuperAdmin(user.roles) || isSectionAdmin(user.roles, "primaire") || isSectionAdmin(user.roles, "secondaire");
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name, sections").order("name");
  const { data: sous } = await supabase.from("sous_branches").select("id, branche_id, name").order("name");

  const sbByBranch = new Map<string, { id: string; name: string }[]>();
  for (const s of sous ?? []) {
    const arr = sbByBranch.get(s.branche_id) ?? [];
    arr.push({ id: s.id, name: s.name });
    sbByBranch.set(s.branche_id, arr);
  }

  const items = (branches ?? []).map((b: any) => ({
    id: b.id,
    name: b.name,
    sections: b.sections as string[],
    sous_branches: sbByBranch.get(b.id) ?? [],
  }));

  return <BranchesManager branches={items} canManage={canManage} />;
}
