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

function fmt(d: Date): string {
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
