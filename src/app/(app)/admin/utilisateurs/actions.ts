"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser, isSuperAdmin, type Role, type Section } from "@/lib/auth";
import { validateUsersCsv, type CsvRow } from "@/lib/csv";
import { seedRosterForUser } from "@/lib/roster";

export type RoleInput = { role: Role; section?: Section | null };

type Result = { error?: string; tempPassword?: string };
export type ImportResult = { created: number; errors: string[] };

async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.roles)) {
    redirect("/login");
  }
}

export async function createUser(input: {
  email: string;
  full_name: string;
  phone?: string | null;
  password?: string;
  roles: RoleInput[];
}): Promise<Result> {
  await requireSuperAdmin();

  const email = input.email.trim().toLowerCase();
  if (!email || !input.full_name.trim()) {
    return { error: "L'e-mail et le nom sont obligatoires." };
  }
  const password = input.password && input.password.length >= 6
    ? input.password
    : undefined;
  const generated = password ? undefined : crypto.randomUUID().slice(0, 12).replace(/-/g, "") + "A1!";

  const admin = createAdminClient();

  // 1. Create auth user (email confirmed)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: password ?? generated,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (error) return { error: error.message };
  const userId = data.user!.id;

  // 2. Profile
  const { error: pErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: input.full_name,
    phone: input.phone ?? null,
  });
  if (pErr) return { error: `Profil : ${pErr.message}` };

  // 3. Roles
  for (const r of input.roles) {
    const { error: rErr } = await admin.from("user_roles").insert({
      user_id: userId,
      role: r.role,
      section: r.section ?? null,
    });
    if (rErr) return { error: `Rôle ${r.role} : ${rErr.message}` };
  }

  // 4. Roster rows for active/upcoming years (best-effort: no years yet is a
  // normal no-op — the next year creation backfills from roles anyway).
  // Covers importUsersCsv too, which delegates to createUser.
  try {
    await seedRosterForUser(admin, userId);
  } catch (e) {
    console.error("seedRosterForUser:", e instanceof Error ? e.message : e);
  }

  revalidatePath("/admin/utilisateurs");
  return { tempPassword: generated };
}

export async function updateUser(input: {
  userId: string;
  full_name: string;
  email?: string;
  password?: string;
  phone?: string | null;
  disabled?: boolean;
  roles: RoleInput[];
}): Promise<Result> {
  await requireSuperAdmin();
  const admin = createAdminClient();

  if (!input.full_name.trim()) {
    return { error: "Le nom est obligatoire." };
  }

  // 0. Auth user: keep the Supabase-side identity in sync — the dashboard
  //    reads user_metadata.full_name for the display name; the login e-mail
  //    and the password change only when actually provided. Runs first so a
  //    taken e-mail or a bad password fails before anything else is updated.
  const { data: authData } = await admin.auth.admin.getUserById(input.userId);
  const currentEmail = (authData?.user?.email ?? "").toLowerCase();
  const authPatch: { user_metadata: { full_name: string }; email?: string; email_confirm?: boolean; password?: string } = {
    user_metadata: { full_name: input.full_name },
  };
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!email) return { error: "L'e-mail est obligatoire." };
    if (email !== currentEmail) {
      authPatch.email = email;
      authPatch.email_confirm = true;
    }
  }
  if (input.password) {
    if (input.password.length < 6) {
      return { error: "Le mot de passe doit contenir au moins 6 caractères." };
    }
    authPatch.password = input.password;
  }
  const { error: auErr } = await admin.auth.admin.updateUserById(input.userId, authPatch);
  if (auErr) {
    if (auErr.message.toLowerCase().includes("already")) {
      return { error: "Cet e-mail est déjà utilisé par un autre compte." };
    }
    return { error: `Compte : ${auErr.message}` };
  }

  // 1. Profile + disabled
  const { error: pErr } = await admin
    .from("profiles")
    .update({ full_name: input.full_name, phone: input.phone ?? null, disabled: input.disabled ?? false })
    .eq("id", input.userId);
  if (pErr) return { error: `Profil : ${pErr.message}` };

  // 2. Replace roles (delete + insert)
  const { error: dErr } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", input.userId);
  if (dErr) return { error: `Rôles : ${dErr.message}` };

  for (const r of input.roles) {
    const { error: rErr } = await admin.from("user_roles").insert({
      user_id: input.userId,
      role: r.role,
      section: r.section ?? null,
    });
    if (rErr) return { error: `Rôle ${r.role} : ${rErr.message}` };
  }

  // 3. Roster rows for a newly granted teacher role (best-effort, same rule
  // as createUser — without this a promoted teacher stays unassignable).
  try {
    await seedRosterForUser(admin, input.userId);
  } catch (e) {
    console.error("seedRosterForUser:", e instanceof Error ? e.message : e);
  }

  revalidatePath("/admin/utilisateurs");
  return {};
}

export async function resetPassword(userId: string): Promise<Result> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const temp = crypto.randomUUID().slice(0, 12).replace(/-/g, "") + "A1!";
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: temp,
  });
  if (error) return { error: error.message };
  return { tempPassword: temp };
}

export async function toggleActive(userId: string, disabled: boolean): Promise<Result> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ disabled })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin/utilisateurs");
  return {};
}

export async function importUsersCsv(rows: CsvRow[]): Promise<ImportResult> {
  await requireSuperAdmin();
  const { data, errors: validation } = validateUsersCsv(rows);
  const errors = validation.map((v) => `Ligne ${v.line} : ${v.message}`);
  let created = 0;

  for (const u of data) {
    // Resolve role/section to RoleInput; super_admin has no section.
    const roleInput: RoleInput =
      u.role === "super_admin"
        ? { role: "super_admin", section: null }
        : u.role === "admin_primaire"
          ? { role: "admin_primaire", section: "primaire" }
          : u.role === "admin_secondaire"
            ? { role: "admin_secondaire", section: "secondaire" }
            : { role: "enseignant", section: (u.section as Section | undefined) ?? null };

    const res = await createUser({
      email: u.email,
      full_name: u.full_name,
      phone: u.phone ?? null,
      roles: [roleInput],
    });
    if (res.error) {
      errors.push(`${u.email} : ${res.error}`);
    } else {
      created++;
    }
  }

  revalidatePath("/admin/utilisateurs");
  return { created, errors };
}
