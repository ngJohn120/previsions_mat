"use client";

import { useRouter } from "next/navigation";
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
 * Conflict dialog — points the teacher at the fiche editor, where the
 * A/B/C resolver appears for each detected conflict.
 */
export function ConflitDialog({
  fiche,
  onClose,
}: {
  fiche: FicheListItem;
  onClose: () => void;
}) {
  const router = useRouter();

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
          Ouvrez l'éditeur : le panneau de résolution apparaîtra en haut de la fiche.
          Vous pourrez choisir la version A (votre appareil), la version B (serveur)
          ou saisir une version C.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          <Button
            onClick={() => {
              onClose();
              router.push(`/fiche/${fiche.ficheId}`);
            }}
          >
            Ouvrir l'éditeur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
