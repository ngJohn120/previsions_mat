"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// pdfjs-dist is NOT imported at module scope: its canvas module evaluates
// `new DOMMatrix()` at import time, which crashes during server-side
// rendering. It is loaded lazily, only inside the client effect.

const PREVIEW_ERROR = "Impossible de préparer l’aperçu. Réessayez dans un instant.";

/** Passe n'importe quel échec d'aperçu vers le message approuvé (maquette 20). */
export function pdfPreviewError(_cause: unknown): string {
  return PREVIEW_ERROR;
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  // Worker PDF.js servi depuis /public (copié par postinstall depuis
  // node_modules/pdfjs-dist) — même version que la lib, pas de CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;

/**
 * Aperçu client du PDF officiel : récupère exactement le même PDF que le
 * bouton « Télécharger » (/impression/[ficheId]/pdf) et le dessine page par
 * page via PDF.js. États chargement/erreur conformes à la maquette 20.
 */
export function PdfPreview({ ficheId }: { ficheId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setPages([]);
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setPages([]);

      let loaded: PdfDocument | null = null;
      const urls: string[] = [];

      try {
        const res = await fetch(`/impression/${ficheId}/pdf`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`PDF_FETCH_${res.status}`);
        const bytes = await res.arrayBuffer();

        const pdfjs = await loadPdfjs();
        loaded = await pdfjs.getDocument({ data: bytes }).promise;
        pdfRef.current = loaded;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const container = document.querySelector<HTMLElement>("[data-pdf-preview]");
        const avail = container?.offsetWidth ?? 1080;

        for (let i = 1; i <= loaded.numPages; i++) {
          if (cancelled) return;
          const page = await loaded.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (avail - 48) / base.width; // padding du conteneur compris
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.setAttribute("aria-label", `Aperçu — page ${i} sur ${loaded.numPages}`);
          canvas.className = "block h-auto w-full";

          await page.render({ canvas, viewport }).promise;

          urls.push(canvas.toDataURL("image/png"));
          page.cleanup();
        }

        if (!cancelled) {
          setPages(urls);
          setLoading(false);
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(pdfPreviewError(e));
        setLoading(false);
      } finally {
        if (cancelled && loaded) {
          loaded.destroy().catch(() => {});
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ficheId, attempt]);

  // Destruction du document PDF au démontage / changement de fiche.
  useEffect(() => {
    return () => {
      pdfRef.current?.destroy().catch(() => {});
      pdfRef.current = null;
    };
  }, []);

  const total = loading && pages.length === 0 ? null : pages.length;

  return (
    <div data-pdf-preview className="mx-auto flex max-w-[1100px] flex-col items-center gap-6 px-4 py-6">
      {loading && (
        <>
          <div className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
            <div className="flex flex-col gap-2 px-11 py-10">
              <div className="mx-auto h-4 w-3/5 animate-pulse rounded bg-slate-200" />
              <div className="mx-auto h-3 w-2/5 animate-pulse rounded bg-slate-100" />
              <div className="mx-auto h-3 w-1/3 animate-pulse rounded bg-slate-100" />
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="h-2.5 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 animate-pulse rounded bg-slate-100" />
              </div>
              <div className="mt-4 grid grid-cols-6 gap-1.5">
                {Array.from({ length: 30 }, (_, i) => (
                  <div key={i} className="h-4 rounded bg-slate-100" />
                ))}
              </div>
            </div>
          </div>
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-700" />
            Préparation de l&apos;aperçu officiel…
          </p>
        </>
      )}

      {!loading && error && (
        <div className="flex w-full max-w-3xl items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          {error}
          <button
            onClick={retry}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            Réessayer
          </button>
        </div>
      )}

      {!loading && !error && pages.map((src, i) => (
        <div key={i} className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Aperçu — page ${i + 1} sur ${total}`} className="block h-auto w-full" />
        </div>
      ))}

      {!loading && !error && total !== null && (
        <p className="pb-2 text-xs text-slate-400">
          — Page 1 / {total} —
        </p>
      )}
    </div>
  );
}