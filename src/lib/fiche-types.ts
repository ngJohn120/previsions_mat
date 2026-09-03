import type { Section } from "@/lib/auth";

// ---------- Shared domain types (used by editors, print, admin) ----------

export type FicheStatut = "brouillon" | "soumise";

export type FicheRowType = "enseignement" | "evenement";

export type FicheRow = {
  id: string;
  fiche_id: string;
  row_uuid: string;
  ordre: number;
  row_type: FicheRowType;
  mois: string | null;
  semaine_num: number | null;
  date_label: string | null;
  periode_label: string | null;
  evenement_label: string | null;
  cells: FicheCellMap;
};

/** Map col_key → cell (id + value + version) for a row. */
export type FicheCellMap = Record<
  string,
  { id: string; value: string; version: number }
>;

export type FicheMeta = {
  section: Section;
  classe: string;
  cours: string;
  sous_branche: string | null;
  enseignant: string;
  school_year_label: string;
};

export type FicheWithRows = {
  fiche: {
    id: string;
    attribution_id: string;
    school_year_id: string;
    statut: FicheStatut;
    version: number;
    conflit: boolean;
    submitted_at: string | null;
    created_at: string;
    updated_at: string;
  };
  meta: FicheMeta;
  rows: FicheRow[];
};

// Column display groups (kept here so both grids + print share semantics).
export const PRIMARY_COLS = [
  "matieres",
  "ref",
  "intention",
  "obs",
] as const;
export const SECONDARY_COLS = [
  "matieres",
  "heure",
  "mv",
  "obs",
] as const;

/** Required columns by section (spec §6). */
export function requiredColsForSection(section: Section): string[] {
  return section === "secondaire"
    ? ["matieres", "heure"]
    : ["matieres", "ref", "intention"];
}

export type FicheListItemData = {
  ficheId: string;
  classe: string;
  section: Section;
  cours: string;
  sousBranche: string | null;
  statut: FicheStatut;
  conflit: boolean;
  progression: number;
  updatedAt: string | null;
  submittedAt: string | null;
  hasPendingUnlock: boolean;
};

/** Compute progression % (filled required cells / total required cells). */
export function ficheProgression(f: FicheWithRows): number {
  const req = requiredColsForSection(f.meta.section);
  let total = 0;
  let filled = 0;
  for (const r of f.rows) {
    if (r.row_type !== "enseignement") continue;
    for (const col of req) {
      const cell = r.cells[col];
      if (!cell) continue;
      total++;
      if (cell.value.trim() !== "") filled++;
    }
  }
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

/** True if the fiche has every required cell filled (matches submit gate). */
export function ficheIsComplete(f: FicheWithRows): boolean {
  const req = requiredColsForSection(f.meta.section);
  for (const r of f.rows) {
    if (r.row_type !== "enseignement") continue;
    for (const col of req) {
      const cell = r.cells[col];
      if (!cell || cell.value.trim() === "") return false;
    }
  }
  return true;
}
