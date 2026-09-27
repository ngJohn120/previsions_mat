/**
 * Regroup the modal's sous-branche rows by name, so one row can carry
 * several classes: the catalogue stores one row per (branche, nom, classe),
 * while the UI works with one row per sous-branche name.
 *
 * A row keeps the id of an existing (branche, nom, classe) entry so edits
 * update in place instead of recreating rows; when a name has more existing
 * entries than the row's selected classes, the extra ones are reported so the
 * caller can delete them (they can no longer be reached through the row).
 */
export type SousRowInput = { id?: string; name: string; classe_id: string | null };
export type SousGroup = { name: string; classeIds: string[]; ids: string[] };

/** One row per distinct non-empty sous-branche name, classes sorted like the input. */
export function groupSousByName(rows: SousRowInput[]): SousGroup[] {
  const byName = new Map<string, SousGroup>();
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    const g = byName.get(name) ?? { name, classeIds: [], ids: [] };
    if (r.classe_id && !g.classeIds.includes(r.classe_id)) g.classeIds.push(r.classe_id);
    if (r.id && !g.ids.includes(r.id)) g.ids.push(r.id);
    byName.set(name, g);
  }
  return [...byName.values()];
}

/** Expand UI rows (one per name) into storage rows (one per name+classe). */
export function expandSousRows(rows: SousRowInput[]): SousRowInput[] {
  const out: SousRowInput[] = [];
  for (const g of groupSousByName(rows)) {
    const classes = g.classeIds.length ? g.classeIds : [null];
    classes.forEach((classeId, i) => out.push({ name: g.name, classe_id: classeId, id: g.ids[i] }));
  }
  return out;
}
