"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAttribution, updateAttribution, deleteAttribution, importAttributionsCsv } from "@/app/(app)/[section]/attributions/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

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
type Option = { id: string; name: string; branche_id?: string };
type TeacherOption = { id: string; full_name: string };

function statutChip(statut: string | null) {
  if (statut === "soumise") return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Soumise</span>;
  if (statut === "brouillon") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Brouillon</span>;
  return <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-400">—</span>;
}

export function AttributionsManager({
  section, yearId, yearLabel, items, classOptions, branchOptions, sousOptions, teacherOptions, orphanAttrIds, canManage, superAdmin,
}: {
  section: string;
  yearId: string;
  yearLabel: string;
  items: Attr[];
  classOptions: Option[];
  branchOptions: Option[];
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
  const [enseignantId, setEnseignantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table filters
  const [search, setSearch] = useState("");
  const [coursFilter, setCoursFilter] = useState("");
  const [enseignantFilter, setEnseignantFilter] = useState("");

  const sectionLabel = section === "primaire" ? "Primaire" : "Secondaire";
  const filteredSous = sousOptions.filter((s) => s.branche_id === brancheId);

  // Already-assigned sous-branches for the selected classe+cours (create mode):
  // disabled in the checkbox list so the unique constraint can't be hit.
  const takenSous = useMemo(() => {
    const m = new Map<string, string>();
    if (!edit) {
      for (const it of items) {
        if (it.classe_id === classeId && it.branche_id === brancheId && it.sous_branche_id) {
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
    setEdit(null); setClasseId(classOptions[0]?.id ?? ""); setBrancheId(branchOptions[0]?.id ?? ""); setSousIds([]); setEnseignantId(teacherOptions[0]?.id ?? ""); setError(null); setOpen(true);
  }

  function openEdit(a: Attr) {
    const bid = branchOptions.find((b) => b.name === a.branche)?.id ?? "";
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
      const res = edit
        ? await updateAttribution({
            id: edit.id,
            section: sectionKey,
            classe_id: classeId,
            branche_id: brancheId,
            sous_branche_id: sousIds[0] ?? null,
            enseignant_id: enseignantId,
          })
        : await createAttribution({
            school_year_id: yearId,
            section: sectionKey,
            classe_id: classeId,
            branche_id: brancheId,
            sous_branche_ids: sousIds,
            enseignant_id: enseignantId,
          });
      if (res.error) { setError(res.error); setBusy(false); return; }
    } catch {
      setError("La requête n'a pas abouti. Vérifiez si la modification a été enregistrée, puis réessayez.");
      setBusy(false); return;
    }
    setOpen(false); setBusy(false); router.refresh();
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
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
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
                <td className="px-4 py-3 font-semibold text-slate-800">{a.classe}</td>
                <td className="px-4 py-3">{a.branche}</td>
                <td className="px-4 py-3 text-slate-500">{a.sous_branche ?? "—"}</td>
                <td className={`px-4 py-3 ${orphan ? "font-bold text-red-700" : ""}`}>{a.enseignant}</td>
                <td className="px-4 py-3">{statutChip(a.statut)}</td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(a)}>Modifier</Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDelete(a)}>Suppr.</Button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {shownItems.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={brancheId} onChange={(e) => { setBrancheId(e.target.value); setSousIds([]); }}>
                {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {!edit && filteredSous.length > 0 && (
              <div>
                <Label>Sous-branches</Label>
                <div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-md border border-slate-200 px-3 py-2">
                  {filteredSous.map((s) => {
                    const takenBy = takenSous.get(s.id);
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
                        <span>{s.name}{takenBy ? ` (déjà : ${takenBy})` : ""}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Cochez une ou plusieurs sous-branches — une attribution et sa fiche seront créées pour chacune.</p>
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
