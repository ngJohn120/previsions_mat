// Pure calendar/template row generation helpers.
// No DB access — pure date math + row shaping, testable in isolation.

export type Week = {
  semaine_num: number;
  start: Date;
  end: Date;
  mois: string; // month label of the start date
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** DD/MM/YYYY formatter (exported: server actions build date_label with it). */
export function fmt(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** School weeks between startDate and endDate inclusive, starting ON startDate
 *  (partial first week if startDate isn't a Monday), each week Mon–Fri-ish range.
 *  Matches the paper forms which start numbering from the rentrée date. */
export function buildWeeks(startDate: Date, endDate: Date): Week[] {
  const weeks: Week[] = [];
  // First week: from startDate to the following Friday (or endDate if sooner)
  let cursor = new Date(startDate);
  let num = 1;

  // Iterate week by week: each week starts on `cursor`, ends on the Friday after
  while (cursor <= endDate) {
    const weekStart = new Date(cursor);
    // End = start + 4 days (Fri) unless we're at a partial trailing week
    let weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 4);
    if (weekEnd > endDate) weekEnd = new Date(endDate);

    const moisIdx = weekStart.getMonth();
    weeks.push({
      semaine_num: num,
      start: weekStart,
      end: weekEnd,
      mois: MONTHS_FR[moisIdx],
    });
    num++;
    // Next Monday after this week's end (end day + 3 → Monday if end is Friday)
    cursor = new Date(weekEnd);
    cursor.setDate(cursor.getDate() + 3); // Friday + 3 = Monday
  }
  return weeks;
}

export type RowSeed = {
  row_type: "enseignement" | "evenement";
  ordre: number;
  mois: string | null;
  semaine_num: number | null;
  date_label: string | null;
  periode_label: string | null;
  evenement_label: string | null;
};

export type EventSpec = {
  label: string;           // display label e.g. "Vacances de Noël"
  type: string;            // 'evaluation' | 'examen' | 'revision' | 'vacances' | 'detente'
  start: Date;
  end: Date;
};

export type PeriodSpec = {
  label: string;           // e.g. "1re période"
  start: Date;
  end: Date;
};

/**
 * Generate ordered template rows for a section's year.
 * Teaching weeks get semaine_num/date_label; event periods become band rows.
 * @param weeks teaching weeks (from buildWeeks)
 * @param events special periods to insert as event rows at their position
 * @param periodeByWeek optional map of week number -> period label
 */
export function generateRowsForSection(
  weeks: Week[],
  events: EventSpec[] = [],
  periodeByWeek: Map<number, string> = new Map()
): RowSeed[] {
  const rows: RowSeed[] = [];

  // Convert events to comparable start dates and sort by start
  const sortedEvents = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  let evIdx = 0;

  for (const w of weeks) {
    // Insert events that fall before/at this week's start (i.e., before this teaching week)
    const weekStart = w.start.getTime();
    while (evIdx < sortedEvents.length && sortedEvents[evIdx].start.getTime() < weekStart) {
      const ev = sortedEvents[evIdx];
      rows.push({
        row_type: "evenement",
        ordre: rows.length + 1,
        mois: null,
        semaine_num: null,
        date_label: `${fmt(ev.start)} → ${fmt(ev.end)}`,
        periode_label: ev.label,
        evenement_label: ev.type,
      });
      evIdx++;
    }

    rows.push({
      row_type: "enseignement",
      ordre: rows.length + 1,
      mois: w.mois,
      semaine_num: w.semaine_num,
      date_label: `${fmt(w.start)} → ${fmt(w.end)}`,
      periode_label: periodeByWeek.get(w.semaine_num) ?? null,
      evenement_label: null,
    });
  }

  // Trailing events after last teaching week
  while (evIdx < sortedEvents.length) {
    const ev = sortedEvents[evIdx];
    rows.push({
      row_type: "evenement",
      ordre: rows.length + 1,
      mois: null,
      semaine_num: null,
      date_label: `${fmt(ev.start)} → ${fmt(ev.end)}`,
      periode_label: ev.label,
      evenement_label: ev.type,
    });
    evIdx++;
  }

  return rows;
}

/** French month label for a Date. */
export function monthLabel(d: Date): string {
  return MONTHS_FR[d.getMonth()];
}

/** Short display for a week's date range like "01 → 04/09/2026". */
export function shortDateLabel(start: Date, end: Date): string {
  const dd1 = String(start.getDate()).padStart(2, "0");
  const dd2 = String(end.getDate()).padStart(2, "0");
  const mm2 = String(end.getMonth() + 1).padStart(2, "0");
  const yyyy2 = end.getFullYear();
  return `${dd1} → ${dd2}/${mm2}/${yyyy2}`;
}

// ---------------------------------------------------------------------------
// Calendar editing helpers (mid-year adjustments).
// Pure, no DB, no crypto: rows are DB-shaped (EditRow) and operations return
// new arrays — server actions persist the diffs.
// ---------------------------------------------------------------------------

/** DB-shaped template row: RowSeed + stable ids (id = template_rows PK). */
export type EditRow = RowSeed & { id: string; row_uuid: string };

/** Recompute ordre = list position (1-based). */
export function renumberRows<T extends { ordre: number }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ ...r, ordre: i + 1 }));
}

/** Recompute semaine_num 1..n on enseignement rows (list order); events keep null. */
export function resequenceWeeks<T extends RowSeed>(rows: T[]): T[] {
  let n = 0;
  return rows.map((r) => {
    if (r.row_type !== "enseignement") return r;
    n += 1;
    return { ...r, semaine_num: n };
  });
}

const LABEL_DATE_RE = /\d{2}\/\d{2}\/\d{4}/g;

function parseFrDate(s: string): Date {
  const [dd, mm, yyyy] = s.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/** Shift every DD/MM/YYYY found in a date_label by deltaDays. */
export function shiftDateLabel(label: string, deltaDays: number): string {
  return label.replace(LABEL_DATE_RE, (m) => {
    const d = parseFrDate(m);
    d.setDate(d.getDate() + deltaDays);
    return fmt(d);
  });
}

/** Next Monday strictly after d. */
export function nextMondayAfter(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + (((8 - out.getDay()) % 7) || 7));
  return out;
}

/** Monday of d's week. */
export function mondayOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Parse the two DD/MM/YYYY bounds of a date_label ({} when absent/unparseable). */
export function parseLabelBounds(label: string | null): { start?: Date; end?: Date } {
  const m = label?.match(LABEL_DATE_RE);
  return m && m.length === 2 ? { start: parseFrDate(m[0]), end: parseFrDate(m[1]) } : {};
}

/** Parse a single event bound coming from a form: ISO yyyy-mm-dd (the wizard's
 *  <input type="date">) or legacy DD/MM/YYYY (the old free-text modal).
 *  Returns null when unparseable — callers must reject, never store NaN dates. */
export function parseEventDate(input: string): Date | null {
  const s = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const out = new Date(y, m - 1, d);
    // Round-trip guard: new Date(2027, 13, 45) rolls over instead of failing.
    return out.getFullYear() === y && out.getMonth() === m - 1 && out.getDate() === d ? out : null;
  }
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (fr) {
    const out = parseFrDate(s);
    return out.getDate() === Number(fr[1]) && out.getMonth() === Number(fr[2]) - 1 ? out : null;
  }
  return null;
}

/** Recompute mois from the start date for enseignement rows; events stay null. */
export function recomputeMois<T extends RowSeed>(row: T): T {
  if (row.row_type !== "enseignement") return { ...row, mois: null };
  const { start } = parseLabelBounds(row.date_label);
  return start ? { ...row, mois: monthLabel(start) } : row;
}

/** Cascade-shift rows at/after index `from` by deltaDays, then renumber + resequence. */
function shiftFrom<T extends EditRow>(rows: T[], from: number, deltaDays: number): T[] {
  const out = rows.map((r, i) => {
    if (i < from) return r;
    return recomputeMois({ ...r, date_label: r.date_label ? shiftDateLabel(r.date_label, deltaDays) : r.date_label });
  });
  return resequenceWeeks(renumberRows(out));
}

/** Dates for a new teaching week: anchor's successor slot, or (head) the week before the first row. */
export function computeInsertWeek(after: EditRow | null, first: EditRow | null): { dateStart: Date; dateEnd: Date } {
  if (after) {
    const { end } = parseLabelBounds(after.date_label);
    if (end) {
      const dateStart = nextMondayAfter(end);
      return { dateStart, dateEnd: addDays(dateStart, 4) };
    }
  }
  const f = first;
  const { start } = f ? parseLabelBounds(f.date_label) : {};
  if (!start) throw new Error("Impossible de dériver les dates d'insertion.");
  const dateStart = addDays(start, -7);
  return { dateStart, dateEnd: addDays(dateStart, 4) };
}

/** Single-day date for a new event: the Monday of the anchor's start-date week. */
export function computeInsertEventDate(anchor: EditRow | null): Date {
  const { start } = (anchor && parseLabelBounds(anchor.date_label)) || {};
  if (!start) throw new Error("Impossible de dériver la date de l'événement.");
  return mondayOfWeek(start);
}

/**
 * Insert a new teaching week after `afterId` (head when null).
 * Anchored insert occupies the anchor's successor slot: rows AFTER the new row
 * shift +7 days (the new row keeps the dates it was computed with).
 * Head insert fills the empty space before the first row: nothing shifts.
 */
export function applyInsertWeek<T extends EditRow>(rows: T[], afterId: string | null, newRow: T): T[] {
  const at = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : 0;
  const out = [...rows.slice(0, at), { ...newRow, ordre: 0, semaine_num: 0 }, ...rows.slice(at)];
  return afterId
    ? shiftFrom(out, at + 1, 7)
    : resequenceWeeks(renumberRows(out));
}

/**
 * Remove a row by id. Deleting a teaching week closes the gap: all later rows
 * shift −7 days. Deleting an event only removes it (dates untouched).
 */
export function applyDeleteRow<T extends EditRow>(rows: T[], rowId: string): T[] {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return rows;
  const wasTeaching = rows[idx].row_type === "enseignement";
  const out = rows.filter((r) => r.id !== rowId);
  return wasTeaching ? shiftFrom(out, idx, -7) : resequenceWeeks(renumberRows(out));
}

/** Shift the selected row AND every later row by deltaDays (cascade). */
export function applyShift<T extends EditRow>(rows: T[], rowId: string, deltaDays: number): T[] {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return rows;
  return shiftFrom(rows, idx, deltaDays);
}

/** Manual date edit: touches only that row; validates start ≤ end; recomputes mois. */
export function applyManualDates<T extends EditRow>(
  rows: T[], rowId: string, dateStart: Date, dateEnd: Date
): T[] | { error: string } {
  if (dateStart > dateEnd) return { error: "La date de début doit précéder la date de fin." };
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return { error: "Ligne introuvable." };
  const out = [...rows];
  out[idx] = recomputeMois({ ...out[idx], date_label: `${fmt(dateStart)} → ${fmt(dateEnd)}` });
  return out;
}
