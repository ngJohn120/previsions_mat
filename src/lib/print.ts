// Pure helpers for print page composition (A4 landscape, paper-faithful).
import type { FicheRow } from "@/lib/fiche-types";
import type { Section } from "@/lib/auth";

// Month order in the school calendar (primary). Page 1 covers Sept–Jan.
const MONTHS = [
  "Septembre", "Octobre", "Novembre", "Décembre", "Janvier", "Février",
  "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
];

/** Split rows into printable pages.
 *
 *  - Primary: page 1 = all rows up to the end of January (teaching rows whose
 *    month is Sep–Jan plus the event rows nested among them); page 2 = rest.
 *  - Secondary: page 1 = rows through the "Vacances de Noël" band (the first
 *    vacation event), page 2 = rest. If no such band exists, split roughly in
 *    half at a teaching-row boundary.
 */
export function splitPrintPages(
  rows: FicheRow[],
  section: Section
): FicheRow[][] {
  if (section === "primaire") {
    return splitPrimary(rows);
  }
  return splitSecondary(rows);
}

function monthIndex(mois: string | null): number {
  if (!mois) return -1;
  return MONTHS.indexOf(mois);
}

function splitPrimary(rows: FicheRow[]): FicheRow[][] {
  // Page 1 includes teaching rows in Sept..Jan and any events placed before
  // the first Février teaching row.
  const firstFebIdx = rows.findIndex(
    (r) => r.row_type === "enseignement" && monthIndex(r.mois) >= monthIndex("Février")
  );
  const cut =
    firstFebIdx === -1
      ? rows.length
      : firstFebIdx;
  return [rows.slice(0, cut), rows.slice(cut)];
}

function splitSecondary(rows: FicheRow[]): FicheRow[][] {
  // Find the "Vacances de Noël" (or any vacances/end-of-year band) position.
  const noelIdx = rows.findIndex(
    (r) => r.row_type === "evenement" && /noël|fin d'année|vacances/i.test(r.periode_label ?? "")
  );
  if (noelIdx !== -1) {
    // Include the band itself at the end of page 1
    return [rows.slice(0, noelIdx + 1), rows.slice(noelIdx + 1)];
  }
  // Fallback: half-way at teaching row boundary
  const teachIdx = rows
    .map((r, i) => (r.row_type === "enseignement" ? i : -1))
    .filter((i) => i >= 0);
  const mid = teachIdx[Math.floor(teachIdx.length / 2)] ?? Math.floor(rows.length / 2);
  return [rows.slice(0, mid), rows.slice(mid)];
}

/** Week label like "3 · 14→18/09" from row fields (primary print). */
export function primaryWeekLabel(row: FicheRow): string {
  const num = row.semaine_num != null ? `${row.semaine_num} · ` : "";
  const date = row.date_label ? compactRange(row.date_label) : "";
  return num + date;
}

/** Compact "01→04/09" from "01/09/2026 → 04/09/2026" (or "01 → 04/09/2026"). */
function compactRange(label: string): string {
  // Match: <d1>/<m1>/<y1> → <d2>/<m2>/<y2>  OR  <d1> → <d2>/<m2>/<y2>
  const m =
    label.match(/(\d{2})\/(\d{2})\/\d{4}\s*→\s*(\d{2})\/(\d{2})\/(\d{4})/) ||
    label.match(/(\d{2})\s*→\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return label;
  if (m.length === 6) {
    const [, d1, , d2, mo2, y2] = m;
    return `${d1}→${d2}/${mo2}/${y2.slice(2)}`;
  }
  const [, d1, d2, mo2, y2] = m;
  return `${d1}→${d2}/${mo2}/${y2.slice(2)}`;
}
