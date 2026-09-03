import { createClient } from "@/lib/supabase/server";
import type { Section } from "@/lib/auth";
// Shared types + pure helpers live in fiche-types (server-free, safe for client).
export type {
  FicheStatut,
  FicheRowType,
  FicheRow,
  FicheCellMap,
  FicheMeta,
  FicheWithRows,
  FicheListItemData,
} from "@/lib/fiche-types";
export { requiredColsForSection } from "@/lib/fiche-types";
import {
  requiredColsForSection,
  type FicheStatut,
  type FicheRow,
  type FicheRowType,
  type FicheCellMap,
  type FicheListItemData,
  type FicheWithRows,
} from "@/lib/fiche-types";

// ---------- Server helpers (RLS-scoped) ----------

/**
 * Load a fiche with rows + cells for the current user.
 * Access is enforced by RLS (can_access_fiche) — if the caller lacks
 * access, Supabase returns an empty/forbidden set, so we return null.
 */
export async function getFiche(id: string): Promise<FicheWithRows | null> {
  const supabase = await createClient();

  const { data: fiche } = await supabase
    .from("fiches")
    .select(
      "id, attribution_id, school_year_id, statut, version, conflit, submitted_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!fiche) return null;

  const meta = await loadFicheMeta(supabase, fiche.attribution_id);
  const rows = await loadFicheRows(supabase, fiche.id);

  return {
    fiche: {
      id: fiche.id,
      attribution_id: fiche.attribution_id,
      school_year_id: fiche.school_year_id,
      statut: fiche.statut as FicheStatut,
      version: fiche.version,
      conflit: fiche.conflit ?? false,
      submitted_at: fiche.submitted_at,
      created_at: fiche.created_at,
      updated_at: fiche.updated_at,
    },
    meta,
    rows,
  };
}

/**
 * Same as getFiche but guards ownership for the editor route:
 * teachers may open only their own attribution's fiche; admins their section.
 */
export async function getFicheForUser(id: string): Promise<FicheWithRows | null> {
  return getFiche(id);
}

/**
 * May the current user edit this fiche's cells?
 * True only for the owning teacher while the fiche is a draft.
 */
export async function canEditFiche(
  data: FicheWithRows,
  user: { id: string } | null
): Promise<boolean> {
  if (!user) return false;
  if (data.fiche.statut !== "brouillon") return false;
  const supabase = await createClient();
  const { data: attr } = await supabase
    .from("attributions")
    .select("enseignant_id")
    .eq("id", data.fiche.attribution_id)
    .single();
  return attr?.enseignant_id === user.id;
}

type RowRow = {
  id: string;
  fiche_id: string;
  row_uuid: string;
  ordre: number;
  row_type: string;
  mois: string | null;
  semaine_num: number | null;
  date_label: string | null;
  periode_label: string | null;
  evenement_label: string | null;
};

type CellRow = {
  id: string;
  fiche_row_id: string;
  col_key: string;
  value: string;
  version: number;
};

// The joined payload types PostgREST returns for relational selects.
type MetaPayload = {
  classe: { name: string; section: Section } | null;
  branche: { name: string } | null;
  sous_branche: { name: string } | null;
  enseignant: { full_name: string } | null;
  school_year: { label: string } | null;
};

type AttributionListPayload = {
  id: string;
  classe: { name: string; section: Section } | null;
  branche: { name: string } | null;
  sous_branche: { name: string } | null;
  enseignant: { full_name: string } | null;
  school_year: { label: string } | null;
  fiche: { id: string } | null;
};

async function loadFicheMeta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attributionId: string
) {
  const { data } = await supabase
    .from("attributions")
    .select(
      "id, classe:classes(name, section), branche:branches(name), sous_branche:sous_branches(name), enseignant:profiles(full_name), school_year:school_years(label)"
    )
    .eq("id", attributionId)
    .maybeSingle<MetaPayload>();

  if (!data) {
    return {
      section: "primaire" as Section,
      classe: "—",
      cours: "—",
      sous_branche: null,
      enseignant: "—",
      school_year_label: "",
    };
  }

  return {
    section: (data.classe?.section ?? "primaire") as Section,
    classe: data.classe?.name ?? "—",
    // "cours" = branche (+ sous-branche when present) — matches terminology
    cours: data.branche?.name ?? "—",
    sous_branche: data.sous_branche?.name ?? null,
    enseignant: data.enseignant?.full_name ?? "—",
    school_year_label: data.school_year?.label ?? "",
  };
}

async function loadFicheRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ficheId: string
): Promise<FicheRow[]> {
  const { data: rows } = await supabase
    .from("fiche_rows")
    .select("*")
    .eq("fiche_id", ficheId)
    .order("ordre");
  const { data: cells } = await supabase
    .from("fiche_cells")
    .select("id, fiche_row_id, col_key, value, version")
    .in(
      "fiche_row_id",
      (rows ?? []).map((r) => r.id)
    );

  const cellMap = new Map<string, FicheCellMap>();
  for (const c of (cells ?? []) as CellRow[]) {
    const rowMap = cellMap.get(c.fiche_row_id) ?? {};
    rowMap[c.col_key] = { id: c.id, value: c.value, version: c.version };
    cellMap.set(c.fiche_row_id, rowMap);
  }

  return (rows ?? []).map((r: RowRow) => ({
    id: r.id,
    fiche_id: r.fiche_id,
    row_uuid: r.row_uuid,
    ordre: r.ordre,
    row_type: r.row_type as FicheRowType,
    mois: r.mois,
    semaine_num: r.semaine_num,
    date_label: r.date_label,
    periode_label: r.periode_label,
    evenement_label: r.evenement_label,
    cells: cellMap.get(r.id) ?? {},
  }));
}

/** List the current user's fiches (teacher: their own; admin: section). */
export async function listFichesForUser(yearId: string): Promise<FicheWithRows[]> {
  const supabase = await createClient();

  const { data: attribs } = await supabase
    .from("attributions")
    .select(
      "id, classe:classes(name, section), branche:branches(name), sous_branche:sous_branches(name), enseignant:profiles(full_name), school_year:school_years(label), fiche:fiches(id)"
    )
    .eq("school_year_id", yearId)
    .returns<AttributionListPayload[]>();

  // RLS already restricts to accessible attributions; filter to ones that
  // actually have a fiche (draft or submitted) for listing purposes.
  const withFiche = (attribs ?? []).filter((a) => a.fiche);
  const out: FicheWithRows[] = [];

  for (const a of withFiche) {
    const fiche = await getFiche(a.fiche!.id);
    if (fiche) out.push(fiche);
  }

  // Keep stable order by classe name then branche
  return out.sort((x, y) =>
    (x.meta.classe + x.meta.cours).localeCompare(y.meta.classe + y.meta.cours)
  );
}

type ListRowPayload = {
  id: string;
  classe: { name: string; section: Section } | null;
  branche: { name: string } | null;
  sous_branche: { name: string } | null;
  fiche: {
    id: string;
    statut: FicheStatut;
    conflit: boolean;
    updated_at: string;
    submitted_at: string | null;
  } | null;
};

type PendingUnlockRow = { fiche_id: string };

/**
 * Compact list of the current user's fiches for the teacher dashboard
 * (single round-trip; avoids loading full rows/cells per fiche).
 * Includes whether an unlock request is currently pending.
 */
export async function listFicheItems(yearId: string): Promise<FicheListItemData[]> {
  const supabase = await createClient();

  const { data: attribs } = await supabase
    .from("attributions")
    .select(
      "id, classe:classes(name, section), branche:branches(name), sous_branche:sous_branches(name), fiche:fiches(id, statut, conflit, updated_at, submitted_at)"
    )
    .eq("school_year_id", yearId)
    .returns<ListRowPayload[]>();

  const items = (attribs ?? []).filter((a): a is typeof a & { fiche: NonNullable<typeof a.fiche> } => !!a.fiche);

  const ficheIds = items.map((a) => a.fiche!.id);
  let pendingSet = new Set<string>();
  if (ficheIds.length > 0) {
    const { data: pending } = await supabase
      .from("unlock_requests")
      .select("fiche_id")
      .in("fiche_id", ficheIds)
      .eq("statut", "en_attente")
      .returns<PendingUnlockRow[]>();
    pendingSet = new Set((pending ?? []).map((p) => p.fiche_id));
  }

  const rows: FicheListItemData[] = items.map((a) => {
    const fiche = a.fiche!;
    return {
      ficheId: fiche.id,
      classe: a.classe?.name ?? "—",
      section: a.classe?.section ?? "primaire",
      cours: a.branche?.name ?? "—",
      sousBranche: a.sous_branche?.name ?? null,
      statut: fiche.statut,
      conflit: fiche.conflit ?? false,
      progression: 0, // patched after cell counts loaded below
      updatedAt: fiche.updated_at,
      submittedAt: fiche.submitted_at,
      hasPendingUnlock: pendingSet.has(fiche.id),
    };
  });

  // Load per-fiche progression: count required cells filled vs total.
  // (One extra round-trip for rows + cells of the listed fiches.)
  for (const item of rows) {
    const { data: fr } = await supabase
      .from("fiche_rows")
      .select("id, row_type")
      .eq("fiche_id", item.ficheId);
    const teachIds = (fr ?? []).filter((r) => r.row_type === "enseignement").map((r) => r.id);
    if (teachIds.length === 0) continue;
    const req = requiredColsForSection(item.section);
    const { count: filled } = await supabase
      .from("fiche_cells")
      .select("id", { count: "exact", head: true })
      .in("fiche_row_id", teachIds)
      .in("col_key", req)
      .neq("value", "");
    const total = teachIds.length * req.length;
    item.progression = total ? Math.round(((filled ?? 0) / total) * 100) : 0;
  }

  return rows.sort((x, y) => (x.classe + x.cours).localeCompare(y.classe + y.cours));
}
