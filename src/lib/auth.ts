import { createClient } from "@/lib/supabase/server";

export type Role = "super_admin" | "admin_primaire" | "admin_secondaire" | "enseignant";
export type Section = "primaire" | "secondaire";

export type UserRole = {
  role: Role;
  section: Section | null;
};

export type SessionUser = {
  id: string;
  email: string | undefined;
  fullName: string | null;
  roles: UserRole[];
};

/**
 * Fetch the current authenticated user with profile + roles.
 * Returns null if no session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, disabled")
    .eq("id", user.id)
    .single();

  if (profile?.disabled) {
    // Disabled account — treat as no access (sign out handled by client)
    return null;
  }

  // Roles
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role, section")
    .eq("user_id", user.id);

  return {
    id: user.id,
    email: user.email ?? undefined,
    fullName: profile?.full_name ?? null,
    roles: (roles ?? []).map((r) => ({
      role: r.role as Role,
      section: (r.section ?? null) as Section | null,
    })),
  };
}

export function isSuperAdmin(roles: UserRole[]): boolean {
  return roles.some((r) => r.role === "super_admin");
}

export function isSectionAdmin(roles: UserRole[], section: Section): boolean {
  return roles.some(
    (r) =>
      r.role === ("admin_" + section) ||
      (r.role === "admin_primaire" && section === "primaire") ||
      (r.role === "admin_secondaire" && section === "secondaire")
  );
}

export function isEnseignant(roles: UserRole[]): boolean {
  return roles.some((r) => r.role === "enseignant");
}

/** Which sections can this user administer (super => both). */
export function adminSections(roles: UserRole[]): Section[] {
  if (isSuperAdmin(roles)) return ["primaire", "secondaire"];
  const sections: Section[] = [];
  if (isSectionAdmin(roles, "primaire")) sections.push("primaire");
  if (isSectionAdmin(roles, "secondaire")) sections.push("secondaire");
  return sections;
}
