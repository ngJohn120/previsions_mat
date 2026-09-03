import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersManager } from "@/components/users/users-manager";

export const dynamic = "force-dynamic";

export type UserItem = {
  id: string;
  full_name: string;
  phone: string | null;
  disabled: boolean;
  email: string;
  roles: { role: string; section: string | null }[];
};

export default async function UtilisateursPage() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.roles)) redirect("/login");

  const admin = createAdminClient();

  // Full user list (auth) via service role
  const { data: authUsers, error: auErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (auErr) throw new Error(auErr.message);
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  // Profiles
  const { data: profiles } = await admin.from("profiles").select("id, full_name, phone, disabled");

  // Roles
  const { data: roles } = await admin.from("user_roles").select("user_id, role, section");

  const roleMap = new Map<string, { role: string; section: string | null }[]>();
  for (const r of roles ?? []) {
    const arr = roleMap.get(r.user_id) ?? [];
    arr.push({ role: r.role, section: r.section });
    roleMap.set(r.user_id, arr);
  }

  const items: UserItem[] = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    phone: p.phone,
    disabled: p.disabled,
    email: emailById.get(p.id) ?? "",
    roles: roleMap.get(p.id) ?? [],
  }));

  return <UsersManager users={items} />;
}
