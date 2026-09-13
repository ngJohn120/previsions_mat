import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { parseLabelBounds } from "@/lib/calendar";
import { GenerationWizard, type EventType } from "@/components/calendar/generation-wizard";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

const EVENT_TYPES: EventType[] = ["vacances", "evaluation", "examen", "revision", "detente"];

/** Local Date → yyyy-mm-dd for <input type="date"> (no UTC shift). */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function GenererCalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; resume?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");

  const { section, resume: resumeId } = await searchParams;
  const sectionKey = section === "secondaire" ? "secondaire" : "primaire";

  const supabase = await createClient();
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, status, start_date, end_date");

  const selectedYear = (years ?? []).find((y: { id: string }) => y.id === cookieYear)
    ?? (years ?? []).find((y: { status: string }) => y.status === "active")
    ?? (years ?? [])[0];

  let activeVersion: number | null = null;
  if (selectedYear) {
    const { data: tv } = await supabase
      .from("template_versions")
      .select("version")
      .eq("school_year_id", selectedYear.id)
      .eq("section", sectionKey)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeVersion = tv?.version ?? null;
  }

  if (!selectedYear) redirect("/admin/calendrier");

  // Resume mode: prefill the wizard from an existing DRAFT of this year+section.
  // Anything else (unknown id, other year/section, active version) goes back —
  // resuming must never silently edit the wrong model.
  let resume: { versionId: string; version: number } | null = null;
  let initialParams: { startDate: string; endDate: string } | null = null;
  let initialEvents: { label: string; type: EventType; start: string; end: string }[] | null = null;
  if (resumeId) {
    const { data: tv } = await supabase
      .from("template_versions")
      .select("id, version, school_year_id, section, is_active")
      .eq("id", resumeId)
      .single();
    if (!tv || tv.school_year_id !== selectedYear.id || tv.section !== sectionKey || tv.is_active) {
      redirect(`/admin/calendrier?section=${sectionKey}`);
    }
    const { data: draftRows } = await supabase
      .from("template_rows")
      .select("row_type, date_label, periode_label, evenement_label")
      .eq("template_version_id", tv.id)
      .order("ordre");
    const bounds = (draftRows ?? [])
      .map((r: { date_label: string | null }) => parseLabelBounds(r.date_label))
      .filter((b) => b.start && b.end) as { start: Date; end: Date }[];
    if (bounds.length === 0) redirect(`/admin/calendrier?section=${sectionKey}`);
    const minStart = new Date(Math.min(...bounds.map((b) => b.start.getTime())));
    const maxEnd = new Date(Math.max(...bounds.map((b) => b.end.getTime())));
    resume = { versionId: tv.id, version: tv.version };
    initialParams = { startDate: toIso(minStart), endDate: toIso(maxEnd) };
    // Events resurface even when their stored dates are missing/unparseable
    // (label prefilled, dates left empty for repair) — dropping them would
    // silently lose the user's input. Step 2 validation blocks progress until
    // every row has valid dates.
    initialEvents = (draftRows ?? [])
      .filter((r: { row_type: string }) => r.row_type === "evenement")
      .map((r: { date_label: string | null; periode_label: string | null; evenement_label: string | null }) => ({
        label: r.periode_label ?? "",
        type: (EVENT_TYPES.includes(r.evenement_label as EventType)
          ? r.evenement_label
          : "vacances") as EventType,
        ...(() => {
          const b = parseLabelBounds(r.date_label);
          return { start: b.start ? toIso(b.start) : "", end: b.end ? toIso(b.end) : "" };
        })(),
      }))
      .filter((e: { label: string }) => e.label.trim());
  }

  return (
    <GenerationWizard
      yearId={selectedYear.id}
      yearLabel={selectedYear.label}
      yearStart={selectedYear.start_date}
      yearEnd={selectedYear.end_date}
      section={sectionKey}
      activeVersion={activeVersion}
      resume={resume}
      initialParams={initialParams}
      initialEvents={initialEvents}
    />
  );
}
