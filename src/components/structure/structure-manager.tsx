"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClass, updateClass, deleteClass, importClassesCsv } from "@/app/(app)/[section]/structure/actions";
import { CsvImportDialog } from "@/components/ui/csv-import-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type ClassItem = {
  id: string;
  name: string;
  level: string;
  ordre: number;
  titulaire_id: string | null;
  titulaire_name: string | null;
  cours_count: number;
};
type Teacher = { id: string; full_name: string };

export function StructureManager({
  section, yearId, yearLabel, classes, teachers, canManage, superAdmin,
}: {
  section: string;
  yearId: string;
  yearLabel: string;
  classes: ClassItem[];
  teachers: Teacher[];
  canManage: boolean;
  superAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<ClassItem | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const [ordre, setOrdre] = useState(0);
  const [titulaireId, setTitulaireId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionTitle = section === "primaire" ? "Primaire" : "Secondaire";

  function openCreate() {
    setEdit(null);
    setName(""); setLevel(""); setOrdre(classes.length + 1); setTitulaireId(""); setError(null);
    setOpen(true);
  }
  function openEdit(c: ClassItem) {
    setEdit(c);
    setName(c.name); setLevel(c.level); setOrdre(c.ordre); setTitulaireId(c.titulaire_id ?? ""); setError(null);
    setOpen(true);
  }

  async function submit() {
    setBusy(true); setError(null);
    // A throwing action (transport/RSC failure) must release the dialog
    // instead of spinning forever — surface it as a plain error.
    try {
      const res = edit
        ? await updateClass({ id: edit.id, section: section as any, name, level, ordre, titulaire_id: titulaireId || null })
        : await createClass({ school_year_id: yearId, section: section as any, name, level, ordre, titulaire_id: titulaireId || null });
      if (res.error) { setError(res.error); setBusy(false); return; }
    } catch {
      setError("La requête n'a pas abouti. Vérifiez si la modification a été enregistrée, puis réessayez.");
      setBusy(false); return;
    }
    setOpen(false); setBusy(false);
    router.refresh();
  }

  async function handleDelete(c: ClassItem) {
    if (!confirm(`Supprimer la classe ${c.name} ?`)) return;
    const res = await deleteClass(c.id, section as any);
    if (res.error) alert(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Structure scolaire · {sectionTitle}</h1>
          <p className="text-sm text-slate-500">Année {yearLabel || "—"}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {superAdmin && (
              <Button variant="outline" onClick={() => router.push(`/${section === "primaire" ? "secondaire" : "primaire"}/structure`)}>
                Voir {section === "primaire" ? "Secondaire" : "Primaire"}
              </Button>
            )}
            <Button onClick={openCreate}><span className="mr-1">+</span> Ajouter une classe</Button>
            <Button variant="outline" onClick={() => setCsvOpen(true)}>Importer (CSV)</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {classes.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{c.level}</span>
              {canManage && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>✎</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(c)} className="text-red-600">🗑</Button>
                </div>
              )}
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900">{c.name}</div>
            <div className="mt-1 text-sm text-slate-500">
              Titulaire : <span className="font-medium text-slate-700">{c.titulaire_name ?? "— (à désigner)"}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500">Cours : <span className="font-medium text-slate-700">{c.cours_count}</span></div>
          </div>
        ))}
        {classes.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
            Aucune classe pour {sectionTitle} · {yearLabel}. Cliquez « Ajouter une classe ».
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? "Modifier la classe" : "Ajouter une classe"}</DialogTitle>
            <DialogDescription>
              {sectionTitle} · {yearLabel}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Niveau</Label>
                <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Ex. 6e" />
              </div>
              <div>
                <Label>Nom de la classe</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. 6e B" />
              </div>
            </div>
            <div>
              <Label>Ordre</Label>
              <Input type="number" value={ordre} onChange={(e) => setOrdre(Number(e.target.value))} />
            </div>
            <div>
              <Label>Titulaire</Label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={titulaireId}
                onChange={(e) => setTitulaireId(e.target.value)}
              >
                <option value="">— À désigner —</option>
                {edit?.titulaire_id && !teachers.some((t) => t.id === edit.titulaire_id) && (
                  <option value={edit.titulaire_id} disabled>Actuel : {edit.titulaire_name ?? "—"} (hors poste) — choisissez un remplaçant</option>
                )}
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.full_name}</option>
                ))}
              </select>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : edit ? "Enregistrer" : "Créer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {csvOpen && (
        <CsvImportDialog
          entity="classes"
          onOpenChange={setCsvOpen}
          onImported={() => router.refresh()}
          importAction={async (rows) => importClassesCsv(section as "primaire" | "secondaire", yearId, rows)}
          templateColumns={["name", "level", "ordre", "titulaire_email"]}
        />
      )}
    </div>
  );
}
