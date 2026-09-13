"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { buildWeeks, generateRowsForSection, parseEventDate, type EventSpec, type RowSeed } from "@/lib/calendar";
import {
  applyDeleteRow, applyInsertWeek, applyShift,
  computeInsertEventDate, computeInsertWeek,
  fmt, monthLabel, parseLabelBounds, recomputeMois,
  renumberRows, resequenceWeeks, type EditRow,
} from "@/lib/calendar";
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
  /** When false (draft), the version is saved without touching any active version. */
  active?: boolean;
  /** Resume: regenerate INTO this existing draft version instead of creating a new one. */
  resumeVersionId?: string;
}): Promise<Result> {
  await requireCalendarAdmin();

  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return { error: "Dates invalides." };
  }

  const weeks = buildWeeks(start, end);
  // Event dates arrive as ISO yyyy-mm-dd (the wizard's <input type="date">) or
  // legacy DD/MM/YYYY (the old modal). Anything unparseable is rejected here —
  // storing NaN dates would silently poison the version (grid, resume, preview).
  const events: EventSpec[] = [];
  for (let i = 0; i < input.events.length; i++) {
    const e = input.events[i];
    const evStart = parseEventDate(e.start);
    const evEnd = parseEventDate(e.end);
    if (!evStart || !evEnd || evStart > evEnd) {
      return { error: `Événement « ${e.label.trim() || `ligne ${i + 1}`} » : dates invalides.` };
    }
    events.push({ label: e.label, type: e.type, start: evStart, end: evEnd });
  }
  const rows = generateRowsForSection(weeks, events);

  // Resume path: rewrite the rows of an existing DRAFT (same year+section),
  // keeping its version number. Also the only way to activate a draft: submit
  // with active=true from the resume flow.
  if (input.resumeVersionId) {
    const supabase = await createClient();
    const { data: tv } = await supabase
      .from("template_versions")
      .select("id, school_year_id, section, is_active")
      .eq("id", input.resumeVersionId)
      .single();
    if (!tv || tv.school_year_id !== input.yearId || tv.section !== input.section) {
      return { error: "Brouillon introuvable pour cette année/section." };
    }
    if (tv.is_active) {
      return { error: "Seul un brouillon peut être repris." };
    }
    const active = input.active ?? true;
    const { error: delErr } = await supabase
      .from("template_rows")
      .delete()
      .eq("template_version_id", tv.id);
    if (delErr) return { error: delErr.message };
    const insErr = await insertRowSeeds(supabase, tv.id, rows);
    if (insErr) return { error: insErr };
    if (active) {
      const { error: actErr } = await supabase
        .from("template_versions")
        .update({ is_active: true })
        .eq("id", tv.id);
      if (actErr) return { error: actErr.message };
      await supabase
        .from("template_versions")
        .update({ is_active: false })
        .eq("school_year_id", input.yearId)
        .eq("section", input.section)
        .neq("id", tv.id);
    }
    revalidatePath("/admin/calendrier");
    return {};
  }

  const res = await createNewTemplateVersion(input.yearId, input.section, rows, input.active ?? true);
  if ("error" in res) return { error: res.error };

  revalidatePath("/admin/calendrier");
  return {};
}

/** Insert row seeds for a version (shared by create + resume paths). */
async function insertRowSeeds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateVersionId: string,
  rows: RowSeed[]
): Promise<string | null> {
  const seeds = rows.map((r) => ({
    template_version_id: templateVersionId,
    row_uuid: crypto.randomUUID(),
    ordre: r.ordre,
    row_type: r.row_type,
    mois: r.mois,
    semaine_num: r.semaine_num,
    date_label: r.date_label,
    periode_label: r.periode_label,
    evenement_label: r.evenement_label,
  }));
  const { error } = await supabase.from("template_rows").insert(seeds);
  return error?.message ?? null;
}

/** Delete a DRAFT template version (its rows cascade). Active versions are
 *  refused — activate another version first (generation does that for you). */
export async function deleteTemplateVersion(input: {
  templateVersionId: string;
}): Promise<Result> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  const { data: tv } = await supabase
    .from("template_versions")
    .select("id, is_active")
    .eq("id", input.templateVersionId)
    .single();
  if (!tv) return { error: "Version introuvable." };
  if (tv.is_active) return { error: "Impossible de supprimer la version active." };
  const { error } = await supabase
    .from("template_rows")
    .delete()
    .eq("template_version_id", tv.id);
  // Rows first is belt-and-braces (FK cascades anyway); then the version.
  if (error) return { error: error.message };
  const { error: vErr } = await supabase
    .from("template_versions")
    .delete()
    .eq("id", tv.id);
  if (vErr) return { error: vErr.message };
  revalidatePath("/admin/calendrier");
  return {};
}

/** Update a single template row (labels/dates/type). */
export async function updateTemplateRow(input: {
  templateVersionId: string;
  rowId: string;
  patch: {
    row_type?: string;
    periode_label?: string | null;
    date_label?: string | null;
    evenement_label?: string | null;
    mois?: string | null;
  };
}): Promise<Result> {
  await requireCalendarAdmin();
  const supabase = await createClient();

  // Server-side mois recompute on any date change (don't trust the client),
  // and block invalid ranges before writing. mois follows the row's actual
  // type: enseignement rows get the start-date month, events stay null.
  const patch = { ...input.patch };
  if (patch.date_label !== undefined) {
    const { start, end } = parseLabelBounds(patch.date_label);
    if (!start || !end || start > end) {
      return { error: "Plage de dates invalide." };
    }
    const { data: target } = await supabase
      .from("template_rows")
      .select("row_type")
      .eq("id", input.rowId)
      .eq("template_version_id", input.templateVersionId)
      .single();
    if (!target) return { error: "Ligne introuvable." };
    patch.mois = recomputeMois({
      row_type: target.row_type,
      ordre: 0,
      mois: null,
      semaine_num: null,
      date_label: patch.date_label,
      periode_label: null,
      evenement_label: null,
    }).mois;
  }

  const { error } = await supabase
    .from("template_rows")
    .update(patch)
    .eq("id", input.rowId)
    .eq("template_version_id", input.templateVersionId);
  if (error) return { error: error.message };

  revalidatePath("/admin/calendrier");
  return {};
}

/** Load a version's rows as EditRows, ordered by ordre. */
async function fetchRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateVersionId: string
): Promise<EditRow[]> {
  const { data, error } = await supabase
    .from("template_rows")
    .select("*")
    .eq("template_version_id", templateVersionId)
    .order("ordre");
  if (error || !data) throw new Error(error?.message ?? "Lignes introuvables.");
  return data as EditRow[];
}

/**
 * Idempotent resequence: rewrite ordre/semaine_num/mois only where they differ
 * from the DB. Self-heals partially-applied cascades on the next operation.
 */
async function resequenceVersionRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateVersionId: string,
  after: EditRow[],
  dbRows: EditRow[]
): Promise<Result> {
  const resequenced = resequenceWeeks(renumberRows(after));
  for (const r of resequenced) {
    // diff against the PRE-OP DB state (not the already-resequenced list!).
    // A row absent from the pre-op fetch (just-inserted) MUST be written —
    // its ordre/semaine_num are still 0.
    const db = dbRows.find((row) => row.id === r.id);
    if (db && db.ordre === r.ordre && db.semaine_num === r.semaine_num && db.mois === r.mois) continue;
    const { error } = await supabase
      .from("template_rows")
      .update({ ordre: r.ordre, semaine_num: r.semaine_num, mois: r.mois })
      .eq("id", r.id)
      .eq("template_version_id", templateVersionId);
    if (error) return { error: error.message };
  }
  return {};
}

/** Delete a template row; deleting a teaching week closes the gap (−7 on later rows). */
export async function deleteTemplateRow(input: {
  templateVersionId: string;
  rowId: string;
}): Promise<Result> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  try {
    const rows = await fetchRows(supabase, input.templateVersionId);
    const target = rows.find((r) => r.id === input.rowId);
    if (!target) return { error: "Ligne introuvable." };

    const after = applyDeleteRow(rows, input.rowId);

    const { error: delErr } = await supabase
      .from("template_rows")
      .delete()
      .eq("id", input.rowId)
      .eq("template_version_id", input.templateVersionId);
    if (delErr) return { error: delErr.message };

    // Write the shifted dates/mois for rows that moved (row beyond `after` list = none).
    for (const r of after) {
      const before = rows.find((row) => row.id === r.id)!;
      if (before.date_label === r.date_label && before.mois === r.mois) continue;
      const { error } = await supabase
        .from("template_rows")
        .update({ date_label: r.date_label, mois: r.mois })
        .eq("id", r.id)
        .eq("template_version_id", input.templateVersionId);
      if (error) return { error: error.message };
    }

    const res = await resequenceVersionRows(supabase, input.templateVersionId, after, rows);
    if (res.error) return res;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
  revalidatePath("/admin/calendrier");
  return {};
}

/** Insert a teaching week after the anchor (successor slot; later rows shift +7). */
export async function insertTemplateWeek(input: {
  templateVersionId: string;
  afterRowId: string;
}): Promise<Result & { id?: string }> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  try {
    const rows = await fetchRows(supabase, input.templateVersionId);
    const anchor = rows.find((r) => r.id === input.afterRowId);
    if (!anchor) return { error: "Ligne d'ancrage introuvable." };

    const { dateStart, dateEnd } = computeInsertWeek(anchor, rows[0] ?? null);
    const newRow: EditRow = {
      id: "", // set by the DB insert
      row_uuid: crypto.randomUUID(),
      row_type: "enseignement",
      ordre: 0,
      mois: monthLabel(dateStart),
      semaine_num: 0,
      date_label: `${fmt(dateStart)} → ${fmt(dateEnd)}`,
      periode_label: null,
      evenement_label: null,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("template_rows")
      .insert({
        template_version_id: input.templateVersionId,
        row_uuid: newRow.row_uuid,
        ordre: 0,
        row_type: newRow.row_type,
        mois: newRow.mois,
        semaine_num: newRow.semaine_num,
        date_label: newRow.date_label,
        periode_label: null,
        evenement_label: null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return { error: insErr?.message ?? "Échec de l'insertion." };
    newRow.id = inserted.id;

    const after = applyInsertWeek(rows, input.afterRowId, newRow);

    // Persist the +7 cascade (dates + mois) for every moved row.
    for (const r of after) {
      const before = rows.find((row) => row.id === r.id);
      if (before && before.date_label === r.date_label && before.mois === r.mois) continue;
      const { error } = await supabase
        .from("template_rows")
        .update({ date_label: r.date_label, mois: r.mois })
        .eq("id", r.id)
        .eq("template_version_id", input.templateVersionId);
      if (error) return { error: error.message };
    }

    const res = await resequenceVersionRows(supabase, input.templateVersionId, after, rows);
    if (res.error) return res;
    revalidatePath("/admin/calendrier");
    return { id: newRow.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Insert an event after the anchor. Dates come from the panel (ISO); when
 *  omitted, defaults to a single day on the anchor week's Monday. No cascade. */
export async function insertTemplateEvent(input: {
  templateVersionId: string;
  afterRowId: string;
  label: string;
  type: string;
  startIso?: string;
  endIso?: string;
}): Promise<Result & { id?: string }> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  try {
    const rows = await fetchRows(supabase, input.templateVersionId);
    const anchor = rows.find((r) => r.id === input.afterRowId);
    if (!anchor) return { error: "Ligne d'ancrage introuvable." };
    const label = input.label.trim();
    if (!label) return { error: "Le libellé est requis." };

    // Resolve dates: explicit panel input (validated) or the single-Monday default.
    let start: Date;
    let end: Date;
    if (input.startIso && input.endIso) {
      start = new Date(`${input.startIso}T00:00:00`);
      end = new Date(`${input.endIso}T00:00:00`);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return { error: "Dates invalides." };
      }
      if (start > end) return { error: "La date de début doit précéder la date de fin." };
    } else {
      start = computeInsertEventDate(anchor);
      end = start;
    }
    const dateLabel = `${fmt(start)} → ${fmt(end)}`;
    const rowUuid = crypto.randomUUID();
    const { data: inserted, error: insErr } = await supabase
      .from("template_rows")
      .insert({
        template_version_id: input.templateVersionId,
        row_uuid: rowUuid,
        ordre: 0,
        row_type: "evenement",
        mois: null,
        semaine_num: null,
        date_label: dateLabel,
        periode_label: label,
        evenement_label: input.type,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return { error: insErr?.message ?? "Échec de l'insertion." };

    // Events don't cascade; place the row in the list and resequence.
    const at = rows.findIndex((r) => r.id === input.afterRowId) + 1;
    const eventRow: EditRow = {
      id: inserted.id,
      row_uuid: rowUuid,
      row_type: "evenement",
      ordre: 0,
      mois: null,
      semaine_num: null,
      date_label: dateLabel,
      periode_label: label,
      evenement_label: input.type,
    };
    const after = resequenceWeeks(
      renumberRows([...rows.slice(0, at), eventRow, ...rows.slice(at)])
    );
    const res = await resequenceVersionRows(supabase, input.templateVersionId, after, rows);
    if (res.error) return res;
    revalidatePath("/admin/calendrier");
    return { id: inserted.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
}

/** Shift the selected row and every later row by deltaDays (cascade). */
export async function shiftTemplateWeek(input: {
  templateVersionId: string;
  rowId: string;
  deltaDays: number;
}): Promise<Result> {
  await requireCalendarAdmin();
  const supabase = await createClient();
  try {
    const rows = await fetchRows(supabase, input.templateVersionId);
    if (!rows.some((r) => r.id === input.rowId)) return { error: "Ligne introuvable." };
    const after = applyShift(rows, input.rowId, input.deltaDays);
    for (const r of after) {
      const before = rows.find((row) => row.id === r.id)!;
      if (before.date_label === r.date_label && before.mois === r.mois) continue;
      const { error } = await supabase
        .from("template_rows")
        .update({ date_label: r.date_label, mois: r.mois })
        .eq("id", r.id)
        .eq("template_version_id", input.templateVersionId);
      if (error) return { error: error.message };
    }
    const res = await resequenceVersionRows(supabase, input.templateVersionId, after, rows);
    if (res.error) return res;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inconnue." };
  }
  revalidatePath("/admin/calendrier");
  return {};
}
