/**
 * The paper layout, computed ONCE in TypeScript and consumed by every renderer
 * (the on-screen grid, the HTML print sheet and the ReportLab PDF).
 *
 * Why: the PDF goes through a separate Python renderer, so a layout decided in
 * two places silently drifts — the preview/PDF kept rendering full-width event
 * bands while the app showed the official layout. Computing it here and passing
 * the result in the payload keeps the Python side a dumb drawer.
 *
 * An event is printed on the row of its FIRST week, centered across the
 * teaching area, and the weeks it continues are marked « (suite) » with the
 * end date when the event stops before that week's last day.
 */
import type { FicheRow, FicheStatut } from "@/lib/fiche-types";
import { eventLabelInWeek, weeksWithEvents, monthBlocks } from "@/lib/fiche-events";

export type PdfRowType = FicheRow["row_type"] | "periode";

/** One printed row: a teaching week, or an event week (no teaching cells). */
export type PdfRow = {
  ordre: number;
  rowType: PdfRowType;
  /** Month label — only on the first row of a month block. */
  mois: string | null;
  /** How many printed rows the month cell spans. */
  moisRowspan: number;
  semaineNum: number | null;
  dateLabel: string | null;
  /** Event text centered across the teaching columns, or null. */
  eventLabel: string | null;
  /** Event kind ("vacances" | "evaluation" | "examen" | …) for tinting. */
  eventKind: string | null;
  cells: Record<string, string>;
};

export type PdfPayload = {
  fiche: { id: string; statut: FicheStatut };
  meta: {
    section: "primaire" | "secondaire";
    classe: string;
    cours: string;
    sousBranche: string | null;
    enseignant: string;
    annee: string;
  };
  rows: PdfRow[];
};

/** Month of the nearest teaching week (an event row borrows it). */
function monthOf(weeks: FicheRow[]): string | null {
  return weeks.find((w) => w.mois)?.mois ?? null;
}
function neighboursOf(weeks: { row: FicheRow }[], self: { row: FicheRow }): FicheRow[] {
  const i = weeks.indexOf(self);
  return [weeks[i - 1]?.row, weeks[i + 1]?.row].filter((w): w is FicheRow => !!w);
}

/** Printable cell values of a row (no ids, no versions). */
function printableCells(row: FicheRow): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const [key, cell] of Object.entries(row.cells)) cells[key] = cell.value;
  return cells;
}

/**
 * Map a fiche to the rows the PDF must draw, using the SAME event placement as
 * the on-screen grid (both sections): an event is printed in full on the first
 * week it covers and the weeks it continues are marked « (suite) » with the end
 * date when it stops before that week's last day.
 */
export function buildPdfRows(rows: FicheRow[]): PdfRow[] {
  const weeks = weeksWithEvents(rows);
  // Month blocks are computed over the PRINTED rows (one per week, event weeks
  // included) — computing them over the teaching-only array misaligns the
  // indices as soon as an event occupies a week slot.
  // An event row has no `mois` of its own; give it its week's month so the block
  // is not broken and the month label lands on the first printed row.
  const monthSource = weeks.map((w) =>
    w.row.mois ? w.row : { ...w.row, mois: w.event ? monthOf(neighboursOf(weeks, w)) : null }
  );
  const months = monthBlocks(monthSource);

  const out: PdfRow[] = [];
  let ordre = 1;
  // A full-width « Nᵉ PÉRIODE » separator precedes the first week of each
  // period (same rule as the on-screen grid): a change of `periode_label`.
  let lastPeriod: string | null = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const period = w.row.periode_label;
    if (period && period !== lastPeriod) {
      lastPeriod = period;
      out.push({
        ordre: ordre++,
        rowType: "periode",
        mois: null,
        moisRowspan: 1,
        semaineNum: null,
        dateLabel: null,
        eventLabel: period.toUpperCase(),
        eventKind: null,
        cells: {},
      });
    }
    const ev = w.event;
    out.push({
      ordre: ordre++,
      rowType: ev ? "evenement" : "enseignement",
      mois: months[i]?.label ?? null,
      moisRowspan: months[i]?.rowspan ?? 1,
      semaineNum: w.row.semaine_num,
      dateLabel: w.row.date_label,
      eventLabel: ev ? eventLabelInWeek(ev, w.row, w.continues).toUpperCase() : null,
      eventKind: ev?.evenement_label ?? null,
      // An event week carries no teaching content (the event spans the area).
      cells: ev ? {} : printableCells(w.row),
    });
  }
  return out;
}
