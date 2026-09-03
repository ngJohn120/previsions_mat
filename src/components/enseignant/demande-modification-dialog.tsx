"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestFicheUnlock } from "@/app/(app)/enseignant/actions";
import type { FicheListItem } from "./fiche-list";

export function DemandeModificationDialog({
  fiche,
  onClose,
  onDone,
}: {
  fiche: FicheListItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approverLabel =
    fiche.section === "primaire" ? "le Directeur" : "le Préfet / D.E.";

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await requestFicheUnlock(fiche.ficheId, motif);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Demander une modification</DialogTitle>
          <DialogDescription>
            Votre fiche est soumise : toute modification nécessite l'approbation de {approverLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <b className="text-slate-800">Fiche :</b> {fiche.cours} · {fiche.classe}
            <span className="mx-2 text-slate-300">|</span>
            <b className="text-slate-800">État :</b> Soumise
          </div>
          <div>
            <Label htmlFor="motif">Motif de la demande (obligatoire)</Label>
            <textarea
              id="motif"
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Décrivez brièvement ce que vous devez corriger…"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
            />
          </div>
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={busy || !motif.trim()}>
            {busy ? "Envoi…" : "Envoyer la demande"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
