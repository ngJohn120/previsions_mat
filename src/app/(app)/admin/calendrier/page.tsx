import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CalendarManager } from "@/components/calendar/calendar-manager";

export const dynamic = "force-dynamic";

export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");

  const { section } = await searchParams;
  const sectionKey = section === "secondaire" ? "secondaire" : "primaire";

  const supabase = await createClient();
  const { data: activeYear } = await supabase
    .from("school_years")
    .select("id, label")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const yearId = activeYear?.id;
  const yearLabel = activeYear?.label ?? "";

  // Active template version + rows
  let versionInfo: { id: string; version: number } | null = null;
  let rows: any[] = [];
  if (yearId) {
    const { data: tv } = await supabase
      .from("template_versions")
      .select("id, version")
      .eq("school_year_id", yearId)
      .eq("section", sectionKey)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tv) {
      versionInfo = tv;
      const { data: templateRows } = await supabase
        .from("template_rows")
        .select("*")
        .eq("template_version_id", tv.id)
        .order("ordre");
      rows = templateRows ?? [];
    }
  }

  return (
    <CalendarManager
      yearId={yearId ?? ""}
      yearLabel={yearLabel}
      section={sectionKey}
      versionInfo={versionInfo}
      rows={rows.map((r) => ({ ...r, row_uuid: r.row_uuid }))}
    />
  );
}
