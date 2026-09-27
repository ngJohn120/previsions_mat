"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBranche, updateBranche, deleteBranche, importBranchesCsv, type SousBranchePayload } from "@/app/(app)/admin/branches/actions";
import { groupSousByName, mergeSousEntries, type SousEntry } from "@/lib/sous-branches";
import { ClassPicker } from "@/components/branches/class-picker";
import { RowAction } from "@/components/ui/row-action";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, PencilIcon, Trash2Icon } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type SousBranche = { id: string; name: string; classe_id: string | null; classe: string | null };
type Branche = {
  id: string;
  name: string;
  sections: string[];
  classe_ids: string[];
  classes: string[];
  sous_branches: SousBranche[];
  /** Row = the bucket of subjects that have no parent branch (0017). */
  sansBranche?: boolean;
};

/** Sentinel id for the « sans branche » bucket — must match the server action. */
const NO_BRANCH = "__sans_branche__";

type Section = "primaire" | "secondaire";
type ClassOption = { id: string; name: string };

/** A sous-branche row in the modal: one NAME, one or several classes, each
 *  carrying the id of its existing storage row so saves update in place. */
type SousNameRow = { name: string; entries: SousEntry[] };

const LOCKED_SECTION_HINT = "Gérée par la direction (branches partagées)";

function sectionTags(sections: string[]) {
  const both = sections.includes("primaire") && sections.includes("secondaire");
  if (both) return <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">Primaire + Secondaire</span>;
  if (sections.includes("primaire")) return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Primaire</span>;
  if (sections.includes("secondaire")) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Secondaire</span>;
  return null;
}

/** Classe chips: only the classes matching the active class filter (all of them
 *  when no filter is set) — either the branch's own classes (when it has no
 *  sous-branches) or those of its sous-branches, never both. */
function classTags(b: Branche, visibleSous: SousBranche[], nameByClass: Map<string, string>, classeFilter: string) {
  const matches = (id: string | null) => classeFilter === "all" || id === classeFilter;
  const pairs: [string, string][] = visibleSous
    .filter((s) => s.classe_id)
    .map((s) => [s.classe_id as string, nameByClass.get(s.classe_id as string) ?? s.classe ?? "—"]);
  // A branch's own classes only count when it has no sous-branches.
  if (b.sous_branches.length === 0) {
    for (const id of b.classe_ids ?? []) if (matches(id)) pairs.unshift([id, nameByClass.get(id) ?? "—"]);
  }
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
  branches, canManage, scope, classOptions, superAdmin,
}: {
  branches: Branche[];
  canManage: boolean;
  scope: Section[];
  classOptions: ClassOption[];
  superAdmin: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [sbFilter, setSbFilter] = useState("all");
  const [classeFilter, setClasseFilter] = useState("all");
  // Branches whose full sub-branch list is expanded (others show a +N chip).
  const [expandedSous, setExpandedSous] = useState<string[]>([]);
  const SUB_COLLAPSED_MAX = 3;
  const [open, setOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [edit, setEdit] = useState<Branche | null>(null);
  const [name, setName] = useState("");
  const [usePrim, setUsePrim] = useState(true);
  const [useSec, setUseSec] = useState(true);
  const [sousBranches, setSousBranches] = useState<SousNameRow[]>([{ name: "", entries: [] }]);
  const [branchClasses, setBranchClasses] = useState<string[]>([]);
  // « Cette matière n'appartient à aucune branche » (create mode only)
  const [sansBranche, setSansBranche] = useState(false);
  /** True when the modal creates a standalone subject: the name IS the subject
   *  (no branch row, no sub-branch level — the classes attach to the name). */
  const sansBrancheMode = !edit && sansBranche;
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

  // Name lookup for any class a row references — including one from another
  // school year, which is not in `classOptions` (those hold the selected year).
  const nameByClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of classOptions) m.set(c.id, c.name);
    for (const b of branches) {
      (b.classes ?? []).forEach((n, i) => {
        const id = b.classe_ids?.[i];
        if (id) m.set(id, n);
      });
      for (const s of b.sous_branches) if (s.classe && s.classe_id) m.set(s.classe_id, s.classe);
    }
    return m;
  }, [branches, classOptions]);

  // « Classe » filter choices: every class referenced by the branch itself or by
  // one of its sous-branches.
  const classeChoices = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) {
      for (const id of b.classe_ids ?? []) m.set(id, nameByClass.get(id) ?? "—");
      for (const s of b.sous_branches) if (s.classe_id) m.set(s.classe_id, s.classe ?? "—");
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [branches, nameByClass]);

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
      if (activeClasseFilter !== "all" && !(b.classe_ids ?? []).includes(activeClasseFilter)
        && !b.sous_branches.some((s) => s.classe_id === activeClasseFilter)) return false;
      return true;
    });
  }, [branches, query, sectionFilter, sbFilter, activeClasseFilter]);

  function openCreate() {
    setEdit(null); setName("");
    setUsePrim(canPrim); setUseSec(canSec);
    setSousBranches([{ name: "", entries: [] }]);
    setBranchClasses([]);
    setSansBranche(false);
    setError(null); setOpen(true);
  }
  function openEdit(b: Branche) {
    setEdit(b); setName(b.name);
    setUsePrim(b.sections.includes("primaire"));
    setUseSec(b.sections.includes("secondaire"));
    // One UI row per sous-branche NAME; its classes are the distinct ones the
    // catalogue holds for that name (the same name may exist for 1ère and 2e).
    const byName = new Map<string, SousNameRow>();
    for (const s of b.sous_branches) {
      const row = byName.get(s.name) ?? { name: s.name, entries: [] };
      if (s.classe_id && !row.entries.some((e) => e.classeId === s.classe_id)) {
        row.entries.push({ classeId: s.classe_id, id: s.id });
      }
      byName.set(s.name, row);
    }
    setSousBranches([...byName.values(), { name: "", entries: [] }]);
    setBranchClasses(b.classe_ids ?? []);
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
    // « sans branche » mode: the name IS the subject, so there is no second
    // level — the storage row is the subject itself, once per selected class.
    const rows: SousBranchePayload[] = sansBrancheMode
      ? branchClasses.map((classe_id) => ({ name: name.trim(), classe_id }))
      : allowSousBranches
        ? sousBranches
            .filter((s) => s.name.trim())
            // one UI row = one name with N classes ⇒ N storage rows, each
            // carrying the id of the row it replaces (or none for a new class)
            .flatMap<SousBranchePayload>((s) =>
              s.entries.length
                ? s.entries.map((e) => ({ id: e.id, name: s.name.trim(), classe_id: e.classeId }))
                : [{ name: s.name.trim(), classe_id: null }]
            )
        : []; // block hidden ⇒ no primaire side ⇒ no sous-branches
    if (sansBrancheMode && !rows.length) {
      setError("Choisissez au moins une classe pour cette matière.");
      setBusy(false);
      return;
    }
    const res = edit
      ? await updateBranche({ id: edit.id, name, sections, classe_ids: branchClasses, sous_branches: rows })
      : await createBranche({
          name,
          sections,
          classe_ids: branchClasses,
          ...(sansBrancheMode ? { id: NO_BRANCH } : {}),
          sous_branches: rows,
        });
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
        {superAdmin && (
          <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="all">Toutes les sections</option>
            {multiSection && <option value="both">Primaire + Secondaire</option>}
            {canPrim && <option value="prim">Primaire</option>}
            {canSec && <option value="sec">Secondaire</option>}
          </select>
        )}
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

      {/* overflow-x-auto: the table scrolls sideways on narrow screens (house pattern). */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Branche</th>
              {superAdmin && <th className="px-4 py-3">Section(s)</th>}
              <th className="px-4 py-3">Sous-branches</th>
              <th className="px-4 py-3">Classe</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((b) => {
              const sous = visibleSous(b);
              const groups = groupSousByName(sous);
              const expanded = expandedSous.includes(b.id);
              const shown = expanded ? groups : groups.slice(0, SUB_COLLAPSED_MAX);
              const hiddenCount = groups.length - shown.length;
              return (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">
                  {b.sansBranche ? <span className="text-slate-400">—</span> : b.name}
                </td>
                {superAdmin && <td className="px-4 py-3">{sectionTags(b.sections)}</td>}
                <td className="px-4 py-3">
                  {groups.length ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {shown.map((g) => {
                        // Name-only pill; the classes live in the « Classe » column —
                        // hovering states them, and shows the full list.
                        const classes = g.classeIds.map((id) => nameByClass.get(id) ?? "—");
                        const pill = (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g.name}</span>
                        );
                        return classes.length ? (
                          <Tooltip key={g.name}>
                            <TooltipTrigger render={pill} />
                            <TooltipContent>
                              {g.name} · {classes.join(" · ")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span key={g.name}>{pill}</span>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedSous((arr) => [...arr, b.id])}
                          className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          title="Afficher toutes les sous-branches"
                        >
                          +{hiddenCount}
                        </button>
                      )}
                      {expanded && groups.length > SUB_COLLAPSED_MAX && (
                        <button
                          type="button"
                          onClick={() => setExpandedSous((arr) => arr.filter((x) => x !== b.id))}
                          className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          title="Réduire la liste"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {(b.classe_ids?.length ?? 0) > 0 || b.sous_branches.some((s) => s.classe_id)
                    ? classTags(b, sous, nameByClass, activeClasseFilter)
                    : <span className="text-slate-400">—</span>}
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <RowAction label="Modifier" onClick={() => openEdit(b)}>
                        <PencilIcon />
                      </RowAction>
                      <RowAction label="Supprimer" tone="danger" onClick={() => handleDelete(b)}>
                        <Trash2Icon />
                      </RowAction>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={1 + (superAdmin ? 1 : 0) + 1 + 1 + (canManage ? 1 : 0)}
                  className="px-4 py-8 text-center text-slate-400"
                >
                  Aucune branche trouvée
                </td>
              </tr>
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
            {/* Some subjects have no parent branch (report card): create them as
                standalone subjects — the name above is then the subject itself
                and its sous-branches carry the classes. */}
            {!edit && allowSousBranches && (
              <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                  checked={sansBranche}
                  onChange={(e) => setSansBranche(e.target.checked)}
                />
                <span>
                  Cette matière n&apos;appartient à aucune branche
                  <span className="block text-xs text-slate-500">
                    Ex. Dessin, Éducation musicale — la matière existe seule, rattachée à ses classes.
                  </span>
                </span>
              </label>
            )}
            <div>
              <Label>{sansBranche && !edit ? "Nom de la matière" : "Nom de la branche"}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={sansBranche && !edit ? "Ex. Dessin" : "Ex. Français"}
              />
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
            {/* « sans branche » mode: the name IS the subject, so there is no
                second level to declare — the classes attach to the name itself. */}
            {allowSousBranches && !sansBrancheMode && (
              <div>
                <div className="flex items-center justify-between">
                  <Label>Sous-branches (optionnel)</Label>
                  <span className="text-xs text-slate-400">{sousBranches.length}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 pr-7 text-[11px] uppercase text-slate-400">
                  <span className="flex-1">Sous-branche</span>
                  <span className="w-36">Classes</span>
                </div>
                <div className="mt-1 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {sousBranches.map((sb, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Input
                        value={sb.name}
                        onChange={(e) => setSousBranches((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                        placeholder="Ex. Grammaire"
                        className="flex-1"
                      />
                      <ClassPicker
                        className="w-36 shrink-0"
                        options={classOptions}
                        selected={sb.entries.map((e) => e.classeId)}
                        onChange={(ids) => setSousBranches((arr) => arr.map((x, idx) => (idx === i ? { ...x, entries: mergeSousEntries(x.entries, ids) } : x)))}
                        multi
                        title="Classes associées à cette sous-branche (plusieurs possibles)"
                      />
                      <Button variant="ghost" size="sm" onClick={() => setSousBranches((arr) => arr.filter((_, idx) => idx !== i))}>✕</Button>
                    </div>
                  ))}
                  {sousBranches.length === 0 && (
                    <p className="py-2 text-center text-xs text-slate-400">Aucune sous-branche</p>
                  )}
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setSousBranches((arr) => [...arr, { name: "", entries: [] }])}>+ Ajouter une sous-branche</Button>
              </div>
            )}
            {/* Branch without sous-branches: the classes belong to the branch
                itself (link table 0016, several possible). Once a sous-branche
                exists the classes live there, so the field hides itself to keep
                the classes in one place. Same picker as the sous-branche rows. */}
            {allowSousBranches && !hasSousRow() && (
              <div>
                <Label>{sansBrancheMode ? "Classe(s) (optionnel)" : "Classe (optionnel)"}</Label>
                <ClassPicker
                  className="mt-1"
                  options={classOptions}
                  selected={branchClasses}
                  onChange={setBranchClasses}
                  multi
                  title={sansBrancheMode
                    ? "Classes concernées par cette matière"
                    : "Classes associées à la branche, sans sous-branche"}
                />
                {sansBrancheMode && (
                  <p className="mt-1 text-xs text-slate-400">
                    Laissez vide si la matière vaut pour toutes les classes.
                  </p>
                )}
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
