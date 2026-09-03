"use client";

import { useState } from "react";

/**
 * "Télécharger le PDF" button — hits the server-side PDF endpoint
 * (renders this same page with Chrome headless → application/pdf).
 */
export function PdfDownloadButton({
  ficheId,
  scale = 1,
}: {
  ficheId: string;
  scale?: number;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/impression/${ficheId}/pdf?scale=${scale}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        alert(j?.error ?? "Erreur lors de la génération du PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prevision-${ficheId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erreur lors de la génération du PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="inline-flex h-7 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? "Génération…" : "Télécharger le PDF"}
    </button>
  );
}
