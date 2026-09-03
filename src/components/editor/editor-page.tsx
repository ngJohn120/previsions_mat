"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { EditorDocHeader } from "@/components/editor/doc-header";
import { CompletenessBar } from "@/components/editor/completeness-bar";
import { PrimaryGrid } from "@/components/editor/primary-grid";
import { SecondaryGrid } from "@/components/editor/secondary-grid";
import { submitFicheAction } from "@/app/(app)/fiche/actions";
import { requiredColsForSection, type FicheWithRows } from "@/lib/fiche-types";
import { sectionLabel } from "@/lib/school";

/**
 * Shared editor shell. Owns the local (optimistic) cell values map and
 * computes live completeness; renders the section-specific grid.
 */
export function EditorPage({
  data,
  editable,
  viewerName,
}: {
  data: FicheWithRows;
  editable: boolean;
  viewerName: string;
}) {
  const router = useRouter();
  const { fiche, meta, rows } = data;
  const section = meta.section;
  const required = useMemo(() => requiredColsForSection(section), [section]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) {
      for (const cell of Object.values(r.cells)) init[cell.id] = cell.value;
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCellsChange = useCallback(
    (next: Record<string, string>) => setValues(next),
    []
  );

  const completeStats = useMemo(() => {
    let total = 0;
    let filled = 0;
    for (const r of rows) {
      if (r.row_type !== "enseignement") continue;
      for (const col of required) {
        const cell = r.cells[col];
        if (!cell) continue;
        total++;
        if ((values[cell.id] ?? cell.value).trim() !== "") filled++;
      }
    }
    return { filled, total, complete: total > 0 && filled === total };
  }, [rows, required, values]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    const res = await submitFicheAction(fiche.id);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNotice("Fiche soumise avec succès.");
    router.refresh();
  }

  const subtitle = `${meta.classe} · ${sectionLabel(section)} · Année ${meta.school_year_label || "—"} · ${
    meta.enseignant || "—"
  }`;

  return (
    <div className="no-print">
      <EditorToolbar
        backHref="/enseignant"
        backLabel="Mes fiches"
        title={`${meta.cours}${meta.sous_branche ? ` — ${meta.sous_branche}` : ""}`}
        subtitle={subtitle}
        statut={fiche.statut}
        complete={completeStats.complete}
        submitting={submitting}
        onSubmit={editable ? submit : undefined}
        printHref={`/impression/${fiche.id}`}
        syncLabel={fiche.statut === "soumise" ? "Soumise" : editable ? "En ligne · Enregistré" : "Lecture seule"}
      />

      <div className="mx-auto max-w-[1560px] space-y-4 px-4 py-5">
        <EditorDocHeader
          section={section}
          classe={meta.classe}
          titulaireLabel={meta.enseignant}
          branche={meta.cours}
          sousBranche={meta.sous_branche}
          yearLabel={meta.school_year_label}
        />

        {!editable && fiche.statut === "soumise" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
            Cette fiche est <strong>soumise</strong> — lecture seule. Pour modifier, utilisez « Demander une modification » depuis « Mes fiches ».
          </div>
        )}

        {editable && (
          <div className="flex flex-wrap items-center gap-4">
            <CompletenessBar filled={completeStats.filled} total={completeStats.total} />
            <span className="text-xs text-slate-400">
              Les champs marqués d'un point rouge sont obligatoires pour chaque semaine d'enseignement.
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">{notice}</div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {section === "primaire" ? (
            <PrimaryGrid rows={rows} editable={editable} onCellsChange={handleCellsChange} />
          ) : (
            <SecondaryGrid rows={rows} editable={editable} onCellsChange={handleCellsChange} />
          )}
        </div>

        {editable && completeStats.total > 0 && !completeStats.complete && (
          <p className="text-xs text-slate-400">
            Complétez toutes les semaines pour activer le bouton « Soumettre ».
          </p>
        )}
      </div>
    </div>
  );
}
