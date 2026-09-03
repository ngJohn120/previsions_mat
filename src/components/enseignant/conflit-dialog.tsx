"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FicheListItem } from "./fiche-list";

/**
 * Conflict dialog — real data + resolution wired in Phase 4 (P4-5).
 * Until then, it points the teacher at the fiche editor where the
 * conflict resolver will appear once sync detects conflicts.
 */
export function ConflitDialog({
  fiche,
  onClose,
}: {
  fiche: FicheListItem;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conflit à résoudre</DialogTitle>
          <DialogDescription>
            Deux appareils ont modifié la même case pendant que vous étiez hors ligne.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          <b className="text-slate-800">Fiche :</b> {fiche.cours} · {fiche.classe}
        </div>
        <p className="text-sm text-slate-500">
          La résolution détaillée (choisir la version A/B ou saisir une version C)
          sera disponible dans l'éditeur de la fiche à l'étape suivante.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          <Button onClick={onClose}>Ouvrir l'éditeur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
