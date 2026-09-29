"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAttribution, updateAttribution, deleteAttribution, deleteAttributionsBulk, importAttributionsCsv } from "@/app/(app)/[section]/attributions/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { RowAction } from "@/components/ui/row-action";
import { BulkSelectHeader, BulkDeleteAction } from "@/components/ui/bulk-select";

type Attr = {
  id: string;
  classe_id: string;
  branche_id: string;
  sous_branche_id: string | null;
  classe: string;
  classe_section: string;
  branche: string;
  sous_branche: string | null;
  enseignant: string;
  statut: string | null;
};
type Option = { id: string; name: string; branche_id?: string | null; classe_id?: string | null; classe?: string | null };
type TeacherOption = { id: string; full_name: string };

function statutChip(statut: string | null) {
  if (statut === "soumise") return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Soumise</span>;
  if (statut === "brouillon") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Brouillon</span>;
  return <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-400">—</span>;
}

export function AttributionsManager({
  section, yearId, yearLabel, items, classOptions, branchOptions, orphanSubjects, sousOptions, teacherOptions, orphanAttrIds, canManage, superAdmin,
}: {
  section: string;
  yearId: string;
  yearLabel: string;
  items: Attr[];
  classOptions: Option[];
  branchOptions: Option[];
  /** Subjects with no parent branch (0017): each is taught as its own cours. */
  orphanSubjects: Option[];
  sousOptions: Option[]; // {id,name,branche_id}
  teacherOptions: TeacherOption[];
  orphanAttrIds?: string[];
  canManage: boolean;
  superAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [edit, setEdit] = useState<Attr | null>(null);
  const [classeId, setClasseId] = useState("");
  const [brancheId, setBrancheId] = useState("");
  // Sous-branches of the current selection: several in create (one attribution
  // each), at most one in edit (the row's own sous-branche).
  const [sousIds, setSousIds] = useState<string[]>([]);
  // Standalone subjects (0017) picked in their own checkbox group.
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [enseignantId, setEnseignantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bulk selection: ids of the attributions ticked in the table.
  const [selected, setSelected] = useState<string[]>([]);

  // Table filters
  const [search, setSearch] = useState("");
  const [coursFilter, setCoursFilter] = useState("");
  const [enseignantFilter, setEnseignantFilter] = useState("");

  const sectionLabel = section === "primaire" ? "Primaire" : "Secondaire";
  // Sous-branches of the selected cours, limited to the ones that exist for the
  // selected class (a same-named sous-branche can exist per class; NULL = partagée
  // and always offered). Without this the list repeats a name once per class.
  const filteredSous = sousOptions.filter(
    (s) => s.branche_id === brancheId && (!s.classe_id || !classeId || s.classe_id === classeId)
  );
  // Subjects with no parent branch (0017) are their own checkbox group: they
  // apply whatever branch is selected, so they are only scoped by CLASS.
  const orphanForClass = orphanSubjects.filter(
    (o) => !o.classe_id || !classeId || o.classe_id === classeId
  );
  const classNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classOptions) m.set(c.id, c.name);
    return m;
  }, [classOptions]);

  // Already-assigned sous-branches for the selected classe+cours (create mode):
  // disabled in the checkbox list so the unique constraint can't be hit.
  const takenSous = useMemo(() => {
    const m = new Map<string, string>();
    if (!edit) {
      for (const it of items) {
        if (it.classe_id === classeId && it.branche_id === brancheId && it.sous_branche_id) {
          m.set(it.sous_branche_id, it.enseignant);
        }
        // A standalone subject (branche_id NULL) belongs to no branch: mark it
        // taken for this classe whatever cours is selected.
        if (it.classe_id === classeId && !it.branche_id && it.sous_branche_id) {
          m.set(it.sous_branche_id, it.enseignant);
        }
      }
    }
    return m;
  }, [items, edit, classeId, brancheId]);

  function toggleSous(id: string, on: boolean) {
    setSousIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  const shownItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (a) =>
        (!q ||
          `${a.classe} ${a.branche} ${a.sous_branche ?? ""} ${a.enseignant}`.toLowerCase().includes(q)) &&
        (!coursFilter || a.branche === coursFilter) &&
        (!enseignantFilter || a.enseignant === enseignantFilter)
    );
  }, [items, search, coursFilter, enseignantFilter]);
  const filterActive = search !== "" || coursFilter !== "" || enseignantFilter !== "";

  function openCreate() {
    setEdit(null); setClasseId(classOptions[0]?.id ?? ""); setBrancheId(branchOptions[0]?.id ?? ""); setSousIds([]); setOrphanIds([]); setEnseignantId(teacherOptions[0]?.id ?? ""); setError(null); setOpen(true);
  }

  function openEdit(a: Attr) {
    // A branch-less subject (0017) has no branch to resolve — keep the first
    // cours and leave the subject untouched (only the teacher is editable).
    const bid = a.branche_id ? branchOptions.find((b) => b.id === a.branche_id)?.id ?? "" : branchOptions[0]?.id ?? "";
    const sid = a.sous_branche
      ? sousOptions.find((s) => s.branche_id === bid && s.name === a.sous_branche)?.id
      : undefined;
    setEdit(a); setClasseId(classOptions.find((c) => c.name === a.classe)?.id ?? ""); setBrancheId(bid); setSousIds(sid ? [sid] : []); setEnseignantId(teacherOptions.find((t) => t.full_name === a.enseignant)?.id ?? ""); setError(null); setOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    const sectionKey = section as "primaire" | "secondaire";
    // A throwing action (transport/RSC failure) must release the dialog
    // instead of spinning forever — surface it as a plain error.
    try {
      if (edit) {
        // Editing keeps the row's own identity: a branch-less subject (0017)
        // keeps branche_id NULL and its own sous-branche row.
        const res = await updateAttribution({
          id: edit.id,
          section: sectionKey,
          classe_id: classeId,
          branche_id: edit.branche_id,
          sous_branche_id: edit.branche_id ? sousIds[0] ?? null : edit.sous_branche_id,
          enseignant_id: enseignantId,
        });
        if (res.error) { setError(res.error); setBusy(false); return; }
      } else {
        // Two independent batches: the sous-branches of the chosen cours, then
        // the ticked subjects with no parent branch (branche_id NULL, one
        // attribution + fiche each).
        const batches = [
          { branche_id: brancheId, sous_branche_ids: sousIds },
          ...(orphanIds.length ? [{ branche_id: null, sous_branche_ids: orphanIds }] : []),
        ].filter((b) => b.sous_branche_ids.length > 0);
        if (batches.length === 0) {
          setError("Choisissez au moins une sous-branche ou une matière sans branche.");
          setBusy(false);
          return;
        }
        for (const b of batches) {
          const res = await createAttribution({
            school_year_id: yearId,
            section: sectionKey,
            classe_id: classeId,
            branche_id: b.branche_id,
            sous_branche_ids: b.sous_branche_ids,
            enseignant_id: enseignantId,
          });
          if (res.error) { setError(res.error); setBusy(false); return; }
        }
      }
    } catch {
      setError("La requête n'a pas abouti. Vérifiez si la modification a été enregistrée, puis réessayez.");
      setBusy(false); return;
    }
    setOpen(false); setBusy(false); router.refresh();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleAll(on: boolean) {
    setSelected(on ? shownItems.map((a) => a.id) : []);
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return;
    const n = selected.length;
    if (!confirm(`Supprimer ${n} attribution${n > 1 ? "s" : ""} et leur${n > 1 ? "s" : ""} fiche${n > 1 ? "s" : ""} ?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await deleteAttributionsBulk(selected, section as "primaire" | "secondaire");
      if (res.error) { setError(res.error); setBusy(false); return; }
      if (res.skipped?.length) {
        setError(`${res.skipped.length} fiche(s) soumise(s) protégée(s) : non supprimée(s).`);
      }
      setSelected([]);
    } catch {
      setError("La suppression groupée n'a pas abouti. Vérifiez les attributions restantes, puis réessayez.");
    }
    setBusy(false);
    router.refresh();
  }

  async function handleDelete(a: Attr) {
    if (!confirm(`Supprimer l'attribution ${a.branche} · ${a.classe} ?`)) return;
    const res = await deleteAttribution(a.id, section as "primaire" | "secondaire");
    if (res.error) alert(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Attributions · {sectionLabel}</h1>
          <p className="text-sm text-slate-500">Année {yearLabel} — un enseignant par cours et par classe</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {superAdmin && (
              <Button variant="outline" onClick={() => router.push(`/${section === "primaire" ? "secondaire" : "primaire"}/attributions`)}>
                Voir {section === "primaire" ? "Secondaire" : "Primaire"}
              </Button>
            )}
            <Button onClick={openCreate}><span className="mr-1">+</span> Nouvelle attribution</Button>
            <Button variant="outline" onClick={() => setCsvOpen(true)}>Importer (CSV)</Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <Input
              className="h-8 min-w-[180px] flex-1 text-xs"
              placeholder="Rechercher une classe, un cours, un enseignant…"
              aria-label="Rechercher une attribution"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              aria-label="Filtrer par cours"
              value={coursFilter}
              onChange={(e) => setCoursFilter(e.target.value)}
            >
              <option value="">Cours : tous</option>
              {[...new Set(items.map((a) => a.branche))].sort((a, b) => a.localeCompare(b, "fr")).map((c) => <option key={c}>{c}</option>)}
            </select>
            <select
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              aria-label="Filtrer par enseignant"
              value={enseignantFilter}
              onChange={(e) => setEnseignantFilter(e.target.value)}
            >
              <option value="">Enseignant : tous</option>
              {[...new Set(items.map((a) => a.enseignant))].sort((a, b) => a.localeCompare(b, "fr")).map((t) => <option key={t}>{t}</option>)}
            </select>
            <span className="ml-auto text-[11px] font-bold text-slate-400">
              {filterActive
                ? `${shownItems.length} attribution${shownItems.length > 1 ? "s" : ""} affichée${shownItems.length > 1 ? "s" : ""}`
                : `${items.length} attribution${items.length > 1 ? "s" : ""}`}
            </span>
            {canManage && (
              <BulkDeleteAction
                count={selected.length}
                onDelete={handleBulkDelete}
                onClear={() => setSelected([])}
                disabled={busy}
              />
            )}
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {canManage && (
                <th className="w-8 px-2 py-3">
                  <BulkSelectHeader
                    selected={selected}
                    total={shownItems.length}
                    label="les attributions affichées"
                    onToggleAll={toggleAll}
                  />
                </th>
              )}
              <th className="px-4 py-3">Classe</th>
              <th className="px-4 py-3">Cours</th>
              <th className="px-4 py-3">Sous-branche</th>
              <th className="px-4 py-3">Enseignant</th>
              <th className="px-4 py-3">Fiche</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shownItems.map((a) => {
              const orphan = (orphanAttrIds ?? []).includes(a.id);
              return (
              <tr key={a.id} className={orphan ? "bg-red-50 hover:bg-red-100/60" : "hover:bg-slate-50"}>
                {canManage && (
                  <td className="w-8 px-2 py-3">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      checked={selected.includes(a.id)}
                      onChange={() => toggleSelected(a.id)}
                      aria-label={`Sélectionner l'attribution ${a.classe} · ${a.branche}`}
                    />
                  </td>
                )}
                <td className="px-4 py-3 font-semibold text-slate-800">{a.classe}</td>
                <td className="px-4 py-3">{a.branche}</td>
                <td className="px-4 py-3 text-slate-500">{a.sous_branche ?? "—"}</td>
                <td className={`px-4 py-3 ${orphan ? "font-bold text-red-700" : ""}`}>{a.enseignant}</td>
                <td className="px-4 py-3">{statutChip(a.statut)}</td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <RowAction label="Modifier" onClick={() => openEdit(a)}>
                        <PencilIcon />
                      </RowAction>
                      <RowAction label="Supprimer" tone="danger" onClick={() => handleDelete(a)}>
                        <Trash2Icon />
                      </RowAction>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {shownItems.length === 0 && (
              <tr><td colSpan={5 + (canManage ? 1 : 0)} className="px-4 py-8 text-center text-slate-400">
                {filterActive
                  ? "Aucune attribution ne correspond aux filtres."
                  : `Aucune attribution · ${sectionLabel}. Cliquez « Nouvelle attribution ».`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? "Modifier l'attribution" : "Nouvelle attribution"}</DialogTitle>
            <DialogDescription>{sectionLabel} · {yearLabel}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Classe</Label>
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
                {classOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Cours (branche)</Label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={brancheId}
                onChange={(e) => { setBrancheId(e.target.value); setSousIds([]); }}
              >
                {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {!edit && filteredSous.length > 0 && (
              <div>
                <Label>Sous-branches</Label>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-3 py-2">
                  {filteredSous.map((s) => {
                    const takenBy = takenSous.get(s.id);
                    // A class-bound sous-branche always matches the selected class
                    // here, so the suffix is only informative for shared ones.
                    const scope = s.classe_id
                      ? classNameById.get(s.classe_id) ?? null
                      : "toutes classes";
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 text-sm ${takenBy ? "text-slate-400" : ""}`}
                        title={takenBy ? `Déjà attribuée à ${takenBy}` : undefined}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300"
                          checked={sousIds.includes(s.id)}
                          disabled={!!takenBy}
                          onChange={(e) => toggleSous(s.id, e.target.checked)}
                        />
                        <span>
                          {s.name}
                          {scope ? <span className="text-xs text-slate-400"> · {scope}</span> : null}
                          {takenBy ? ` (déjà : ${takenBy})` : ""}
                        </span>
                      </label>
                    );
                  })}
                  {filteredSous.length === 0 && (
                    <p className="py-1 text-center text-xs text-slate-400">
                      Aucune sous-branche pour cette classe — choisissez un autre cours ou créez-la dans Branches.
                    </p>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Cochez une ou plusieurs sous-branches — une attribution et sa fiche seront créées pour chacune.</p>
              </div>
            )}
            {/* Subjects with no parent branch (0017): their own group, ticked
                like sub-branches. One attribution + fiche is created per
                subject, and each is stored with branche_id NULL. */}
            {!edit && orphanForClass.length > 0 && (
              <div>
                <Label>Matières sans branche</Label>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-3 py-2">
                  {orphanForClass.map((o) => {
                    const takenBy = takenSous.get(o.id);
                    return (
                      <label
                        key={o.id}
                        className={`flex items-center gap-2 text-sm ${takenBy ? "text-slate-400" : ""}`}
                        title={takenBy ? `Déjà attribuée à ${takenBy}` : undefined}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300"
                          checked={orphanIds.includes(o.id)}
                          disabled={!!takenBy}
                          onChange={(e) =>
                            setOrphanIds((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))
                          }
                        />
                        <span>
                          {o.name}
                          {takenBy ? ` (déjà : ${takenBy})` : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Cochez une ou plusieurs matières — une attribution et sa fiche seront créées pour chacune.
                </p>
              </div>
            )}
            {edit && filteredSous.length > 0 && (
              <div>
                <Label>Sous-branche (optionnel)</Label>
                <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={sousIds[0] ?? ""} onChange={(e) => setSousIds(e.target.value ? [e.target.value] : [])}>
                  <option value="">— Aucune —</option>
                  {filteredSous.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Enseignant</Label>
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={enseignantId} onChange={(e) => setEnseignantId(e.target.value)}>
                {edit && enseignantId === "" && (
                  <option value="" disabled>Actuel : {edit.enseignant} (hors poste) — choisissez un remplaçant</option>
                )}
                {teacherOptions.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <p className="text-xs text-slate-400">Une fiche brouillon sera créée automatiquement à partir du modèle actif (si généré).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer l'attribution"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {csvOpen && (
        <CsvImportDialog
          entity="attributions"
          onOpenChange={setCsvOpen}
          onImported={() => router.refresh()}
          importAction={async (rows) =>
            importAttributionsCsv(section as "primaire" | "secondaire", yearId, rows)
          }
          templateColumns={["section", "classe", "branche", "sous_branche", "enseignant_email"]}
        />
      )}
    </div>
  );
}
