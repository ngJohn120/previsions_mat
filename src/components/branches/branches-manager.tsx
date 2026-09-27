"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBranche, updateBranche, deleteBranche, importBranchesCsv } from "@/app/(app)/admin/branches/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type SousBranche = { id: string; name: string; classe_id: string | null; classe: string | null };
type Branche = {
  id: string;
  name: string;
  sections: string[];
  classe_id: string | null;
  classe: string | null;
  sous_branches: SousBranche[];
};
type Section = "primaire" | "secondaire";
type ClassOption = { id: string; name: string };
type SousRow = { id?: string; name: string; classe_id: string };

const LOCKED_SECTION_HINT = "Gérée par la direction (branches partagées)";

function sectionTags(sections: string[]) {
  const both = sections.includes("primaire") && sections.includes("secondaire");
  if (both) return <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">Primaire + Secondaire</span>;
  if (sections.includes("primaire")) return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Primaire</span>;
  if (sections.includes("secondaire")) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Secondaire</span>;
  return null;
}

/** Classe chips: the branch's own class (only when it has no sous-branches — the
 *  class belongs either to the branch or to its sous-branches, never both) plus
 *  the classes of the sous-branches currently displayed. */
function classTags(b: Branche, visibleSous: SousBranche[]) {
  const pairs: [string, string][] = visibleSous
    .filter((s) => s.classe_id)
    .map((s) => [s.classe_id as string, s.classe ?? "—"]);
  // A branch's own class only counts when it has no sous-branches.
  if (b.classe_id && b.sous_branches.length === 0) pairs.unshift([b.classe_id, b.classe ?? "—"]);
  const names = [...new Map(pairs).values()];
  if (!names.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n, i) => (
        <span key={i} className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">{n}</span>
      ))}
    </div>
  );
}

export function BranchesManager({
  branches, canManage, scope, classOptions, yearLabel,
}: {
  branches: Branche[];
  canManage: boolean;
  scope: Section[];
  classOptions: ClassOption[];
  yearLabel: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [sbFilter, setSbFilter] = useState("all");
  const [classeFilter, setClasseFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [edit, setEdit] = useState<Branche | null>(null);
  const [name, setName] = useState("");
  const [usePrim, setUsePrim] = useState(true);
  const [useSec, setUseSec] = useState(true);
  const [sousBranches, setSousBranches] = useState<SousRow[]>([{ name: "", classe_id: "" }]);
  const [branchClasse, setBranchClasse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPrim = scope.includes("primaire");
  const canSec = scope.includes("secondaire");
  const multiSection = canPrim && canSec;
  // Sous-branches exist only for primaire subjects.
  // - Section admin: visible iff they manage primaire (scope-based).
  // - Super admin: visible iff "Primaire" is checked (checkbox-based, live).
  const isSuper = multiSection; // super admin = both sections in scope
  const allowSousBranches = isSuper ? usePrim : canPrim;

  /** True when the modal holds at least one named sous-branche (an empty input
   *  row is just the "add one" affordance, not a sous-branche). */
  const hasSousRow = () => sousBranches.some((s) => s.name.trim() !== "");

  // « Classe » filter choices: every class referenced by the branch itself or by
  // one of its sous-branches.
  const classeChoices = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) {
      if (b.classe_id) m.set(b.classe_id, b.classe ?? "—");
      for (const s of b.sous_branches) if (s.classe_id) m.set(s.classe_id, s.classe ?? "—");
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [branches]);

  // If the selected class disappeared from the data (e.g. its last sous-branche
  // was unbound while the filter was active), fall back to "all" at render
  // time instead of silently showing an empty table with no way back.
  const activeClasseFilter =
    classeFilter !== "all" && classeChoices.some(([id]) => id === classeFilter) ? classeFilter : "all";

  // When a class filter is active, a row shows ONLY that class's sous-branches
  // (a branch may hold several classes) — the list must not display data the
  // user filtered out.
  const visibleSous = (b: Branche) =>
    activeClasseFilter === "all"
      ? b.sous_branches
      : b.sous_branches.filter((s) => s.classe_id === activeClasseFilter);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (sectionFilter === "prim" && !b.sections.includes("primaire")) return false;
      if (sectionFilter === "sec" && !b.sections.includes("secondaire")) return false;
      if (sectionFilter === "both" && !(b.sections.includes("primaire") && b.sections.includes("secondaire"))) return false;
      if (sbFilter === "yes" && b.sous_branches.length === 0) return false;
      if (sbFilter === "no" && b.sous_branches.length > 0) return false;
      if (activeClasseFilter !== "all" && b.classe_id !== activeClasseFilter
        && !b.sous_branches.some((s) => s.classe_id === activeClasseFilter)) return false;
      return true;
    });
  }, [branches, query, sectionFilter, sbFilter, activeClasseFilter]);

  function openCreate() {
    setEdit(null); setName("");
    setUsePrim(canPrim); setUseSec(canSec);
    setSousBranches([{ name: "", classe_id: "" }]);
    setBranchClasse("");
    setError(null); setOpen(true);
  }
  function openEdit(b: Branche) {
    setEdit(b); setName(b.name);
    setUsePrim(b.sections.includes("primaire"));
    setUseSec(b.sections.includes("secondaire"));
    const rows: SousRow[] = b.sous_branches.map((s) => ({ id: s.id, name: s.name, classe_id: s.classe_id ?? "" }));
    setSousBranches([...rows, { name: "", classe_id: "" }]);
    setBranchClasse(b.classe_id ?? "");
    setError(null); setOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    // Section admins keep whatever the branch already had outside their scope
    // (e.g. a shared "Primaire + Secondaire" branch edited by a primaire admin
    // stays usable in secondaire — they only manage their own side).
    const preserved = edit
      ? (edit.sections as Section[]).filter((s) => !scope.includes(s))
      : [];
    const sections: Section[] = [...preserved];
    if (usePrim && canPrim) sections.push("primaire");
    if (useSec && canSec) sections.push("secondaire");
    if (!sections.length) { setError("Sélectionnez au moins une section."); setBusy(false); return; }
    const rows = allowSousBranches
      ? sousBranches
          .map((s) => ({ id: s.id, name: s.name.trim(), classe_id: s.classe_id || null }))
          .filter((r) => r.name)
      : []; // block hidden ⇒ no primaire side ⇒ no sous-branches
    const res = edit
      ? await updateBranche({ id: edit.id, name, sections, classe_id: branchClasse || null, sous_branches: rows })
      : await createBranche({ name, sections, classe_id: branchClasse || null, sous_branches: rows });
    if (res.error) { setError(res.error); setBusy(false); return; }
    // NB: no manual router.refresh() — the action's revalidatePath already
    // refreshes the list; the extra refresh races the flight client and can
    // crash the page after a save (same defect class as the users modal).
    setOpen(false); setBusy(false);
  }

  async function handleDelete(b: Branche) {
    if (!confirm(`Supprimer la branche « ${b.name} » ?`)) return;
    const res = await deleteBranche(b.id);
    if (res.error) alert(res.error);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Catalogue des branches</h1>
          <p className="text-sm text-slate-500">Branches partagées et sous-branches utilisables en primaire et/ou secondaire</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button onClick={openCreate}><span className="mr-1">+</span> Nouvelle branche</Button>
            <Button variant="outline" onClick={() => setCsvOpen(true)}>Importer (CSV)</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Rechercher une branche…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
          <option value="all">Toutes les sections</option>
          {multiSection && <option value="both">Primaire + Secondaire</option>}
          {canPrim && <option value="prim">Primaire</option>}
          {canSec && <option value="sec">Secondaire</option>}
        </select>
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sbFilter} onChange={(e) => setSbFilter(e.target.value)}>
          <option value="all">Avec ou sans sous-branches</option>
          <option value="yes">Avec sous-branches</option>
          <option value="no">Sans sous-branche</option>
        </select>
        {classeChoices.length > 0 && (
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={activeClasseFilter}
            onChange={(e) => setClasseFilter(e.target.value)}
            title="Filtrer par classe liée à une sous-branche"
          >
            <option value="all">Toutes les classes</option>
            {classeChoices.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-slate-400">{filtered.length} branche(s)</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Branche</th>
              <th className="px-4 py-3">Section(s)</th>
              <th className="px-4 py-3">Sous-branches</th>
              <th className="px-4 py-3">Classe</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((b) => {
              const sous = visibleSous(b);
              return (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{b.name}</td>
                <td className="px-4 py-3">{sectionTags(b.sections)}</td>
                <td className="px-4 py-3">
                  {sous.length ? (
                    <div className="flex flex-wrap gap-1">
                      {sous.map((s) => (
                        <span key={s.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {s.name}
                          {s.classe ? <span className="text-slate-400"> · {s.classe}</span> : null}
                        </span>
                      ))}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {b.classe_id || b.sous_branches.some((s) => s.classe_id) ? classTags(b, sous) : <span className="text-slate-400">—</span>}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openEdit(b)}>Modifier</Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDelete(b)}>Suppr.</Button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={canManage ? 5 : 4} className="px-4 py-8 text-center text-slate-400">Aucune branche trouvée</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? "Modifier la branche" : "Nouvelle branche"}</DialogTitle>
            <DialogDescription>Nom, sections d&apos;usage et sous-branches (par classe)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nom de la branche</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Français" />
            </div>
            <div>
              <Label>Utilisable en</Label>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2 text-sm" title={!canPrim ? LOCKED_SECTION_HINT : undefined}>
                  <input type="checkbox" checked={usePrim} disabled={!canPrim}
                    onChange={(e) => setUsePrim(e.target.checked)} /> Primaire
                </label>
                <label className="flex items-center gap-2 text-sm" title={!canSec ? LOCKED_SECTION_HINT : undefined}>
                  <input type="checkbox" checked={useSec} disabled={!canSec}
                    onChange={(e) => setUseSec(e.target.checked)} /> Secondaire
                </label>
              </div>
              {!multiSection && (
                <p className="mt-1 text-xs text-slate-400">
                  Votre compte ne gère que la section {canPrim ? "Primaire" : "Secondaire"}. Les branches de la section{" "}
                  {canPrim ? "Secondaire" : "Primaire"} sont gérées par leur direction.
                </p>
              )}
            </div>
            {allowSousBranches && (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Sous-branches (optionnel)</Label>
                  <span className="text-xs text-slate-400">{sousBranches.length}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 pr-7 text-[11px] uppercase text-slate-400">
                  <span className="flex-1">Sous-branche</span>
                  <span className="w-28">Classe</span>
                </div>
                <div className="mt-1 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {sousBranches.map((sb, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={sb.name}
                        onChange={(e) => setSousBranches((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                        placeholder="Ex. Grammaire"
                        className="flex-1"
                      />
                      <select
                        value={sb.classe_id}
                        onChange={(e) => setSousBranches((arr) => arr.map((x, idx) => idx === i ? { ...x, classe_id: e.target.value } : x))}
                        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                        title="Classe associée à cette sous-branche (« Partagée » = toutes les classes)"
                      >
                        <option value="">Partagée</option>
                        {classOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <Button variant="ghost" size="sm" onClick={() => setSousBranches((arr) => arr.filter((_, idx) => idx !== i))}>✕</Button>
                    </div>
                  ))}
                  {sousBranches.length === 0 && (
                    <p className="py-2 text-center text-xs text-slate-400">Aucune sous-branche</p>
                  )}
                </div>
                {yearLabel && (
                  <p className="mt-1 text-xs text-slate-400">Classes proposées : année {yearLabel}.</p>
                )}
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setSousBranches((arr) => [...arr, { name: "", classe_id: "" }])}>+ Ajouter une sous-branche</Button>
              </div>
            )}
            {/* Branch without sous-branches: the class belongs to the branch
                itself. Once a sous-branche exists the class lives there, so the
                field hides itself to keep one class per branch. */}
            {allowSousBranches && !hasSousRow() && (
              <div>
                <Label>Classe (optionnel)</Label>
                <select
                  value={branchClasse}
                  onChange={(e) => setBranchClasse(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  title="Classe associée à la branche (« Partagée » = toutes les classes)"
                >
                  <option value="">Partagée</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {yearLabel && <p className="mt-1 text-xs text-slate-400">Classes proposées : année {yearLabel}.</p>}
              </div>
            )}
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer la branche"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {csvOpen && (
        <CsvImportDialog
          entity="branches"
          onOpenChange={setCsvOpen}
          onImported={() => router.refresh()}
          importAction={async (rows) => importBranchesCsv(rows)}
          templateColumns={["name", "sections", "sous_branches"]}
        />
      )}
    </div>
  );
}
