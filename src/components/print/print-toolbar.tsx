"use client";

import Link from "next/link";
import { PdfDownloadButton } from "@/components/print/pdf-download-button";

/**
 * Impression toolbar (not printed). Client so it can attach onClick handlers.
 */
export function PrintToolbar({
  ficheId,
  editorHref,
  title,
  statut,
  scale,
}: {
  ficheId: string;
  editorHref: string;
  title: string;
  statut: "brouillon" | "soumise";
  scale: number;
}) {
  return (
    <div className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-2.5">
        <Link href={editorHref} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← Retour à l'éditeur
        </Link>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-800">{title}</div>
        </div>
        <div className="flex-1" />
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statut === "brouillon" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700"}`}>
          {statut === "brouillon" ? "Brouillon" : "Soumise"}
        </span>
        <button
          onClick={() => window.print()}
          className="inline-flex h-7 items-center rounded-lg bg-blue-700 px-3 text-sm font-medium text-white hover:bg-blue-800"
        >
          Imprimer / PDF
        </button>
        <PdfDownloadButton ficheId={ficheId} scale={scale} />
      </div>
    </div>
  );
}
