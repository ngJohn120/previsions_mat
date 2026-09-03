"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBranche, updateBranche, deleteBranche } from "@/app/(app)/admin/branches/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type SousBranche = { id: string; name: string };
type Branche = { id: string; name: string; sections: string[]; sous_branches: SousBranche[] };

function sectionTags(sections: string[]) {
  const both = sections.includes("primaire") && sections.includes("secondaire");
  if (both) return <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">Primaire + Secondaire</span>;
  if (sections.includes("primaire")) return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Primaire</span>;
  if (sections.includes("secondaire")) return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Secondaire</span>;
  return null;
}

export function BranchesManager({ branches, canManage }: { branches: Branche[]; canManage: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [sbFilter, setSbFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Branche | null>(null);
  const [name, setName] = useState("");
  const [usePrim, setUsePrim] = useState(true);
  const [useSec, setUseSec] = useState(true);
  const [sousBranches, setSousBranches] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q)) return false;
      if (sectionFilter === "prim" && !b.sections.includes("primaire")) return false;
      if (sectionFilter === "sec" && !b.sections.includes("secondaire")) return false;
      if (sectionFilter === "both" && !(b.sections.includes("primaire") && b.sections.includes("secondaire"))) return false;
      if (sbFilter === "yes" && b.sous_branches.length === 0) return false;
      if (sbFilter === "no" && b.sous_branches.length > 0) return false;
      return true;
    });
  }, [branches, query, sectionFilter, sbFilter]);

  function openCreate() {
    setEdit(null); setName(""); setUsePrim(true); setUseSec(true); setSousBranches([""]); setError(null); setOpen(true);
  }
  function openEdit(b: Branche) {
    setEdit(b); setName(b.name);
    setUsePrim(b.sections.includes("primaire"));
    setUseSec(b.sections.includes("secondaire"));
    setSousBranches(b.sous_branches.map((s) => s.name).concat([""]));
    setError(null); setOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    const sections: ("primaire" | "secondaire")[] = [];
    if (usePrim) sections.push("primaire");
    if (useSec) sections.push("secondaire");
    const names = sousBranches.map((s) => s.trim()).filter(Boolean);
    const res = edit
      ? await updateBranche({ id: edit.id, name, sections, sous_branches: names })
      : await createBranche({ name, sections, sous_branches: names });
    if (res.error) { setError(res.error); setBusy(false); return; }
    setOpen(false); setBusy(false); router.refresh();
  }

  async function handleDelete(b: Branche) {
    if (!confirm(`Supprimer la branche « ${b.name} » ?`)) return;
    const res = await deleteBranche(b.id);
    if (res.error) alert(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Catalogue des branches</h1>
          <p className="text-sm text-slate-500">Branches et sous-branches utilisables en primaire et/ou secondaire</p>
        </div>
        {canManage && <Button onClick={openCreate}><span className="mr-1">+</span> Nouvelle branche</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Rechercher une branche…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
          <option value="all">Toutes les sections</option>
          <option value="both">Primaire + Secondaire</option>
          <option value="prim">Primaire</option>
          <option value="sec">Secondaire</option>
        </select>
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={sbFilter} onChange={(e) => setSbFilter(e.target.value)}>
          <option value="all">Avec ou sans sous-branches</option>
          <option value="yes">Avec sous-branches</option>
          <option value="no">Sans sous-branche</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{filtered.length} branche(s)</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Branche</th>
              <th className="px-4 py-3">Section(s)</th>
              <th className="px-4 py-3">Sous-branches</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{b.name}</td>
                <td className="px-4 py-3">{sectionTags(b.sections)}</td>
                <td className="px-4 py-3">
                  {b.sous_branches.length ? (
                    <div className="flex flex-wrap gap-1">
                      {b.sous_branches.map((s) => (
                        <span key={s.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{s.name}</span>
                      ))}
                    </div>
                  ) : <span className="text-slate-400">—</span>}
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
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Aucune branche trouvée</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? "Modifier la branche" : "Nouvelle branche"}</DialogTitle>
            <DialogDescription>Nom, sections d'usage et sous-branches</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nom de la branche</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Français" />
            </div>
            <div>
              <Label>Utilisable en</Label>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={usePrim} onChange={(e) => setUsePrim(e.target.checked)} /> Primaire</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useSec} onChange={(e) => setUseSec(e.target.checked)} /> Secondaire</label>
              </div>
            </div>
            <div>
              <Label>Sous-branches (optionnel)</Label>
              <div className="mt-1 space-y-2">
                {sousBranches.map((sb, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={sb} onChange={(e) => setSousBranches((arr) => arr.map((x, idx) => idx === i ? e.target.value : x))} placeholder="Ex. Grammaire" />
                    <Button variant="ghost" size="sm" onClick={() => setSousBranches((arr) => arr.filter((_, idx) => idx !== i))}>✕</Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSousBranches((arr) => [...arr, ""])}>+ Ajouter une sous-branche</Button>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer la branche"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
