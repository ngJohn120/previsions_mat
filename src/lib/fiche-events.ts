import type { FicheRow } from "@/lib/fiche-types";

/**
 * Paper-faithful event placement, shared by the on-screen grid and the PDF.
 *
 * On the official document an event (vacances, examens, évaluation) is written
 * on the row of the FIRST week it covers, in its own « Événement » column, and
 * the following weeks of that span stay normal teaching rows — NOT a full-width
 * band between weeks.
 *
 * Event rows carry no `semaine_num` (see `generateRowsForSection`), so each one
 * is attached at render time to the first teaching week whose range it
 * overlaps. No data migration is involved: the stored rows are untouched.
 */

/** DD/MM/YYYY (local, no UTC shift). */
function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** "01/09/2026 → 04/09/2026" → the two dates, or null when unparseable. */
export function parseRange(label: string | null): { start: Date; end: Date } | null {
  if (!label) return null;
  const m = label.match(/(\d{2})\/(\d{2})\/(\d{4})\s*→\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [sd, sm, sy, ed, em, ey] = m.slice(1).map(Number);
  return { start: new Date(sy, sm - 1, sd), end: new Date(ey, em - 1, ed) };
}

/** The event printed on this teaching row, or null. */
export function eventForWeek(rows: FicheRow[], week: FicheRow): FicheRow | null {
  const range = parseRange(week.date_label);
  if (!range || week.semaine_num == null) return null;
  for (const ev of rows) {
    if (ev.row_type !== "evenement") continue;
    const evRange = parseRange(ev.date_label);
    if (!evRange) continue;
    // The event belongs to the first week it overlaps.
    if (evRange.start <= range.end && evRange.end >= range.start) return ev;
  }
  return null;
}

/** Teaching rows only, with the event attached to each (null on most rows). */
export type WeekWithEvent = { row: FicheRow; event: FicheRow | null; continues: boolean };

/**
 * Teaching rows, each with the event that covers it.
 *
 * A multi-week event is printed in full on the FIRST week it covers (as on the
 * official paper) and CONTINUATION weeks are marked as belonging to it, so no
 * week of a holiday looks like an ordinary teaching week.
 */
export function weeksWithEvents(rows: FicheRow[]): WeekWithEvent[] {
  const teaching = rows.filter((r) => r.row_type === "enseignement");
  const events: { row: FicheRow; range: { start: Date; end: Date } }[] = rows
    .filter((r) => r.row_type === "evenement")
    .map((r) => ({ row: r, range: parseRange(r.date_label) }))
    .filter((e): e is { row: FicheRow; range: { start: Date; end: Date } } => e.range !== null);

  const overlaps = (ev: { range: { start: Date; end: Date } }, week: { start: Date; end: Date }) =>
    ev.range.start <= week.end && ev.range.end >= week.start;

  return teaching.map((row, idx) => {
    const week = parseRange(row.date_label);
    if (!week || row.semaine_num == null) return { row, event: null, continues: false };
    const hit = events.find((e) => overlaps(e, week));
    if (!hit) return { row, event: null, continues: false };
    // Printed in full on the EARLIEST teaching week it covers; the following
    // weeks of the span are flagged as its continuation.
    const coveredEarlier = teaching
      .slice(0, idx)
      .some((w) => {
        const r = parseRange(w.date_label);
        return r != null && w.semaine_num != null && overlaps(hit, r);
      });
    return { row, event: hit.row, continues: coveredEarlier };
  });
}

/** Month blocks over the teaching rows: label on the first row of each month. */
export type MonthBlock = { label: string | null; rowspan: number };

export function monthBlocks(weeks: FicheRow[]): MonthBlock[] {
  return weeks.map((r, i) => {
    const prev = weeks[i - 1];
    if (prev && prev.mois === r.mois) return { label: null, rowspan: 1 };
    let rowspan = 1;
    for (let j = i + 1; j < weeks.length && weeks[j].mois === r.mois; j++) rowspan++;
    return { label: r.mois, rowspan };
  });
}

/** Tint for the row that carries an event, mirroring the paper's shading. */
export function eventRowClass(type: string | null): string {
  if (type === "evaluation" || type === "examen") return "bg-purple-50/50";
  if (type === "vacances") return "bg-amber-50/50";
  return "bg-slate-50/60";
}

/** Text colour of the event label, by kind. */
export function eventTextClass(type: string | null): string {
  return type === "evaluation" || type === "examen" ? "text-purple-700" : "text-amber-800";
}

/** Printable label: the period name, else its date range. */
export function eventLabel(ev: FicheRow): string {
  return ev.periode_label ?? ev.date_label ?? "Événement";
}

/**
 * The same label plus the event's END DATE when it stops inside the school
 * week — e.g. « Vacances de Noël (suite) (06/01/2027) » when the holiday ends
 * on Wednesday while the week runs 04/01 → 08/01. Nothing is added when the
 * event already ends on the week's last day.
 */
export function eventLabelInWeek(ev: FicheRow, week: FicheRow, continues: boolean): string {
  const base = `${eventLabel(ev)}${continues ? " (suite)" : ""}`;
  const evRange = parseRange(ev.date_label);
  const weekRange = parseRange(week.date_label);
  if (!evRange || !weekRange) return base;
  return evRange.end < weekRange.end ? `${base} (${fmtDate(evRange.end)})` : base;
}
