"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAttribution, updateAttribution, deleteAttribution, importAttributionsCsv } from "@/app/(app)/[section]/attributions/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type Attr = {
  id: string;
  classe: string;
  classe_section: string;
  branche: string;
  sous_branche: string | null;
  enseignant: string;
  statut: string | null;
};
type Option = { id: string; name: string };
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
  const [sousId, setSousId] = useState("");
  const [enseignantId, setEnseignantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionLabel = section === "primaire" ? "Primaire" : "Secondaire";
  const filteredSous = sousOptions.filter((s: any) => s.branche_id === brancheId);

  function openCreate() {
    setEdit(null); setClasseId(classOptions[0]?.id ?? ""); setBrancheId(branchOptions[0]?.id ?? ""); setSousId(""); setEnseignantId(teacherOptions[0]?.id ?? ""); setError(null); setOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    const payload = {
      section: section as any,
      classe_id: classeId,
      branche_id: brancheId,
      sous_branche_id: sousId || null,
      enseignant_id: enseignantId,
    };
    // A throwing action (transport/RSC failure) must release the dialog
    // instead of spinning forever — surface it as a plain error.
    try {
      const res = edit
        ? await updateAttribution({ id: edit.id, ...payload })
        : await createAttribution({ school_year_id: yearId, ...payload });
      if (res.error) { setError(res.error); setBusy(false); return; }
    } catch {
      setError("La requête n'a pas abouti. Vérifiez si la modification a été enregistrée, puis réessayez.");
      setBusy(false); return;
    }
    setOpen(false); setBusy(false); router.refresh();
  }

  async function handleDelete(a: Attr) {
    if (!confirm(`Supprimer l'attribution ${a.branche} · ${a.classe} ?`)) return;
    const res = await deleteAttribution(a.id, section as any);
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
            {items.map((a) => {
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
                      <Button variant="outline" size="sm" onClick={() => { setEdit(a); setClasseId(classOptions.find((c) => c.name === a.classe)?.id ?? ""); setBrancheId(branchOptions.find((b) => b.name === a.branche)?.id ?? ""); setSousId(""); setEnseignantId(teacherOptions.find((t) => t.full_name === a.enseignant)?.id ?? ""); setError(null); setOpen(true); }}>Modifier</Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDelete(a)}>Suppr.</Button>
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Aucune attribution · {sectionLabel}. Cliquez « Nouvelle attribution ».</td></tr>
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
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={brancheId} onChange={(e) => { setBrancheId(e.target.value); setSousId(""); }}>
                {branchOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Sous-branche (optionnel)</Label>
              <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={sousId} onChange={(e) => setSousId(e.target.value)}>
                <option value="">— Aucune —</option>
                {filteredSous.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
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
