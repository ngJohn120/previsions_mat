import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { CalendarManager } from "@/components/calendar/calendar-manager";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; v?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");

  const { section, v } = await searchParams;
  const sectionKey = section === "secondaire" ? "secondaire" : "primaire";

  const supabase = await createClient();
  // Selected school year: the top-bar switcher cookie (same rule as the app
  // layout) — NOT always the active year. Falls back to the active year.
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, status");

  const selectedYear = (years ?? []).find((y: { id: string }) => y.id === cookieYear)
    ?? (years ?? []).find((y: { status: string }) => y.status === "active")
    ?? (years ?? [])[0];

  const yearId = selectedYear?.id;
  const yearLabel = selectedYear?.label ?? "";

  // All template versions for this year+section, newest first.
  let versions: { id: string; version: number; is_active: boolean }[] = [];
  let rows: any[] = [];
  if (yearId) {
    const { data: tvs } = await supabase
      .from("template_versions")
      .select("id, version, is_active")
      .eq("school_year_id", yearId)
      .eq("section", sectionKey)
      .order("version", { ascending: false });
    versions = tvs ?? [];
  }

  // If ?v=… is provided, select that version (by id — what the selector pushes —
  // or by number for hand-written URLs); otherwise default to the active
  // version (or the newest if none active — e.g. a lone draft).
  const selectedVersion =
    versions.find((tv) => tv.id === v || String(tv.version) === v) ??
    versions.find((tv) => tv.is_active) ??
    versions[0];

  if (selectedVersion) {
    const { data: templateRows } = await supabase
      .from("template_rows")
      .select("*")
      .eq("template_version_id", selectedVersion.id)
      .order("ordre");
    rows = templateRows ?? [];
  }

  return (
    <CalendarManager
      yearLabel={yearLabel}
      section={sectionKey}
      versions={versions}
      selectedVersionId={selectedVersion?.id ?? null}
      rows={rows.map((r) => ({ ...r, row_uuid: r.row_uuid }))}
    />
  );
}
