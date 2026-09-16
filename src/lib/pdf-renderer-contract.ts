import { createHmac } from "node:crypto";
import type { FicheWithRows, FicheRowType, FicheStatut } from "@/lib/fiche-types";

// ---------------------------------------------------------------------------
// Print-only renderer contract.
//
// This module is the ONLY bridge between the RLS-authorised fiche and the
// ReportLab renderer. It deliberately maps the database shape to a small,
// serialisable, print-only payload so the renderer never receives ids,
// versions, sessions, roles, or any Supabase-specific field.
// Server-only: uses node:crypto. Never import from client code.
// ---------------------------------------------------------------------------

export const RENDERER_MAX_ROWS = 400;
export const RENDERER_MAX_LABEL_CHARS = 1_000;
export const RENDERER_MAX_CELL_CHARS = 20_000;

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
  rows: Array<{
    ordre: number;
    rowType: FicheRowType;
    mois: string | null;
    semaineNum: number | null;
    dateLabel: string | null;
    periodeLabel: string | null;
    evenementLabel: string | null;
    cells: Record<string, string>;
  }>;
};

export type RendererEnvelope = {
  issuedAt: number;
  payload: PdfPayload;
};

export class RendererBoundsError extends Error {
  constructor() {
    super("Le document dépasse la taille autorisée.");
    this.name = "RendererBoundsError";
  }
}

/**
 * Map an RLS-authorised fiche to printable values only.
 * Cell objects ({id, value, version}) become plain strings; database ids,
 * attribution ids, versions, timestamps, sessions and roles never cross.
 */
export function toPdfPayload(fiche: FicheWithRows): PdfPayload {
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
    rows: fiche.rows.map((row) => {
      const cells: Record<string, string> = {};
      for (const [key, cell] of Object.entries(row.cells)) {
        cells[key] = cell.value;
      }
      return {
        ordre: row.ordre,
        rowType: row.row_type,
        mois: row.mois,
        semaineNum: row.semaine_num,
        dateLabel: row.date_label,
        periodeLabel: row.periode_label,
        evenementLabel: row.evenement_label,
        cells,
      };
    }),
  };
}

/**
 * Reject payloads that exceed hard document bounds before a request is sent.
 * Throws RendererBoundsError with a stable French message.
 */
export function verifyRendererBounds(payload: PdfPayload): void {
  if (!payload.fiche.id) throw new RendererBoundsError();
  if (payload.rows.length > RENDERER_MAX_ROWS) throw new RendererBoundsError();

  const labels = [
    payload.meta.classe,
    payload.meta.cours,
    payload.meta.sousBranche,
    payload.meta.enseignant,
    payload.meta.annee,
    ...payload.rows.flatMap((row) => [
      row.mois,
      row.dateLabel,
      row.periodeLabel,
      row.evenementLabel,
    ]),
  ];

  for (const label of labels) {
    if (label !== null && label.length > RENDERER_MAX_LABEL_CHARS) {
      throw new RendererBoundsError();
    }
  }

  for (const row of payload.rows) {
    for (const value of Object.values(row.cells)) {
      if (value.length > RENDERER_MAX_CELL_CHARS) throw new RendererBoundsError();
    }
  }
}

/**
 * Serialise the exact envelope body and sign it with a server-only secret.
 * The Python function verifies this signature and refuses anything unsigned.
 */
export function createRendererEnvelope(
  payload: PdfPayload,
  secret: string,
  nowMs?: number
): { body: string; signature: string; issuedAt: number } {
  verifyRendererBounds(payload);
  const issuedAt = Math.floor((nowMs ?? Date.now()) / 1000);
  const body = JSON.stringify({ issuedAt, payload } satisfies RendererEnvelope);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return { body, signature, issuedAt };
}