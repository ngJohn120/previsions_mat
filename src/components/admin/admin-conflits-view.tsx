"use client";

// Admin conflict view: read-only fiche + (when this browser holds local
// conflicts for this fiche) the A/B resolver. Conflicts are local-first;
// cross-device resolution happens on the device that detected them.
import { useState } from "react";
import Link from "next/link";
import { EditorDocHeader } from "@/components/editor/doc-header";
import { PrimaryGrid } from "@/components/editor/primary-grid";
import { SecondaryGrid } from "@/components/editor/secondary-grid";
import { useConflicts, ConflictResolver } from "@/components/editor/conflict-resolver";
import { useLocalFiche } from "@/lib/sync/hooks";
import type { FicheWithRows } from "@/lib/fiche-types";

export function AdminConflitsView({ data }: { data: FicheWithRows }) {
  const { fiche, meta } = data;
  const { rows, status, setStatus, sync } = useLocalFiche(fiche.id, data);
  const { conflicts, refresh: refreshConflicts } = useConflicts(fiche.id, rows);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1560px] space-y-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <Link href="/admin/suivi" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← Suivi des fiches
        </Link>
        <div className="flex-1" />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Conflits · lecture seule
        </span>
      </div>

      <EditorDocHeader
        section={meta.section}
        classe={meta.classe}
        titulaireLabel={meta.enseignant}
        branche={meta.cours}
        sousBranche={meta.sous_branche}
        yearLabel={meta.school_year_label}
      />

      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{notice}</div>
      )}

      {conflicts.length > 0 ? (
        <ConflictResolver
          ficheId={fiche.id}
          conflicts={conflicts}
          onResolved={() => {
            refreshConflicts();
            sync();
            setStatus("online");
            setNotice("Conflits résolus.");
          }}
        />
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {status === "conflit"
            ? "Conflits en cours de détection…"
            : "Aucun conflit détecté sur cet appareil. Les conflits sont détectés localement sur l'appareil de l'enseignant lors de la synchronisation ; invitez l'enseignant à les résoudre depuis son éditeur."}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {meta.section === "primaire" ? (
          <PrimaryGrid rows={rows} editable={false} />
        ) : (
          <SecondaryGrid rows={rows} editable={false} />
        )}
      </div>
    </div>
  );
}
