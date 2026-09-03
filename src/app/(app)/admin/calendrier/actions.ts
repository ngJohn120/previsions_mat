"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { buildWeeks, generateRowsForSection, type EventSpec } from "@/lib/calendar";
import { createNewTemplateVersion } from "@/lib/templates";

type Result = { error?: string };

async function requireCalendarAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");
  return user;
}

export async function generateCalendar(input: {
  yearId: string;
  section: "primaire" | "secondaire";
  startDate: string;
  endDate: string;
  events: { label: string; type: string; start: string; end: string }[];
}): Promise<Result> {
  await requireCalendarAdmin();

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return { error: "Dates invalides." };
  }

  const weeks = buildWeeks(start, end);
  const events: EventSpec[] = input.events.map((e) => ({
    label: e.label,
    type: e.type,
    start: new Date(e.start),
    end: new Date(e.end),
  }));
  const rows = generateRowsForSection(weeks, events);

  const res = await createNewTemplateVersion(input.yearId, input.section, rows);
  if ("error" in res) return { error: res.error };

  revalidatePath("/admin/calendrier");
  return {};
}

/** Update a single template row (type/labels) — creates a new version if drafts exist. */
export async function updateTemplateRow(input: {
  templateVersionId: string;
  rowId: string;
  patch: { row_type?: string; periode_label?: string | null; date_label?: string | null; evenement_label?: string | null };
}): Promise<Result> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("template_rows")
    .update(input.patch)
    .eq("id", input.rowId)
    .eq("template_version_id", input.templateVersionId);
  if (error) return { error: error.message };
  revalidatePath("/admin/calendrier");
  return {};
}
