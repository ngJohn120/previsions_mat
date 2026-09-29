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

export type PdfRowType = FicheRow["row_type"];

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
 * the on-screen grid. Secondary keeps its own band layout (approved design), so
 * its event rows pass through unchanged.
 */
export function buildPdfRows(
  rows: FicheRow[],
  section: "primaire" | "secondaire"
): PdfRow[] {
  const teaching = rows.filter((r) => r.row_type === "enseignement");

  if (section === "secondaire") {
    // The secondary grid is built around period/golden bands: keep its rows.
    return rows.map((row) => ({
      ordre: row.ordre,
      rowType: row.row_type,
      mois: null,
      moisRowspan: 1,
      semaineNum: row.semaine_num,
      dateLabel: row.date_label,
      eventLabel:
        row.row_type === "evenement"
          ? (row.periode_label ?? row.date_label ?? "Événement").toUpperCase()
          : null,
      eventKind: row.evenement_label,
      cells: printableCells(row),
    }));
  }

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

  return weeks.map((w, i) => {
    const ev = w.event;
    return {
      ordre: i + 1,
      rowType: ev ? "evenement" : "enseignement",
      mois: months[i]?.label ?? null,
      moisRowspan: months[i]?.rowspan ?? 1,
      semaineNum: w.row.semaine_num,
      dateLabel: w.row.date_label,
      eventLabel: ev ? eventLabelInWeek(ev, w.row, w.continues).toUpperCase() : null,
      eventKind: ev?.evenement_label ?? null,
      // An event week carries no teaching content (the event spans the area).
      cells: ev ? {} : printableCells(w.row),
    };
  });
}

/** Map an RLS-authorised fiche to printable values only. */
export function toPdfPayload(fiche: {
  fiche: { id: string; statut: FicheStatut };
  meta: {
    section: "primaire" | "secondaire";
    classe: string;
    cours: string;
    sous_branche: string | null;
    enseignant: string;
    school_year_label: string;
  };
  rows: FicheRow[];
}): PdfPayload {
  return {
    fiche: { id: fiche.fiche.id, statut: fiche.fiche.statut },
    meta: {
      section: fiche.meta.section,
      classe: fiche.meta.classe,
      cours: fiche.meta.cours,
      sousBranche: fiche.meta.sous_branche,
      enseignant: fiche.meta.enseignant,
      annee: fiche.meta.school_year_label,
    },
    rows: buildPdfRows(fiche.rows, fiche.meta.section),
  };
}
