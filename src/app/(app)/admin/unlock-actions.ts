"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin, isSectionAdmin } from "@/lib/auth";
import type { Section } from "@/lib/auth";

type Result = { error?: string; ok?: boolean };

export type PendingUnlock = {
  id: string;
  motif: string;
  created_at: string;
  demandeur: { full_name: string } | null;
};

/** List pending unlock requests for a fiche (visible per RLS). */
export async function pendingUnlockRequests(ficheId: string): Promise<PendingUnlock[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("unlock_requests")
    .select("id, motif, created_at, demandeur:profiles(full_name)")
    .eq("fiche_id", ficheId)
    .eq("statut", "en_attente")
    .order("created_at")
    .returns<PendingUnlock[]>();
  return data ?? [];
}

export async function approveUnlockRequest(
  requestId: string,
  section: Section
): Promise<Result> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, section))
    return { error: "Accès refusé." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_unlock", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (row && !row.ok) return { error: row.message };
  revalidatePath("/admin/suivi");
  revalidatePath("/enseignant");
  return { ok: true };
}

export async function refuseUnlockRequest(
  requestId: string,
  section: Section
): Promise<Result> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles) && !isSectionAdmin(user.roles, section))
    return { error: "Accès refusé." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refuse_unlock", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (row && !row.ok) return { error: row.message };
  revalidatePath("/admin/suivi");
  revalidatePath("/enseignant");
  return { ok: true };
}
