import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { titleForSection } from "@/lib/school";
import { generateFichePageImages } from "@/lib/print-pdf";
import { PdfDownloadButton } from "@/components/print/pdf-download-button";

export const dynamic = "force-dynamic";

/**
 * Aperçu impression — affiche le rendu officiel (ReportLab/Python) sous forme
 * d'images par page. Chaque page est un PNG (généré via pypdfium2) : aucune
 * navigation vers un PDF, donc aucun téléchargement intempestif — la page
 * s'affiche dans n'importe quel navigateur / webview.
 */
export default async function ImpressionPage({
  params,
}: {
  params: Promise<{ ficheId: string }>;
}) {
  const { ficheId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getFicheForUser(ficheId);
  if (!data) notFound();

  const statut = data.fiche.statut;
  const section = data.meta.section;
  const title = `${titleForSection(section)} — ${section === "primaire" ? "Primaire" : "Secondaire"}`;

  let pageImages: string[] | null = null;
  let pageError: string | null = null;
  try {
    pageImages = await generateFichePageImages(ficheId);
  } catch (e) {
    pageError = e instanceof Error ? e.message : "Erreur de rendu";
  }

  return (
    <div className="no-print min-h-screen bg-slate-100">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-3 px-4 py-2.5">
          <Link
            href={`/fiche/${ficheId}`}
            className="text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            ← Retour à l&apos;éditeur
          </Link>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-800">{title}</div>
          </div>
          <div className="flex-1" />
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              statut === "brouillon" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700"
            }`}
          >
            {statut === "brouillon" ? "Brouillon" : "Soumise"}
          </span>
          <PdfDownloadButton ficheId={ficheId} />
        </div>
      </div>

      {/* Pages du document */}
      <div className="mx-auto flex max-w-[1100px] flex-col items-center gap-6 px-4 py-6">
        {pageError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {pageError}
          </div>
        )}
        {pageImages?.map((src, i) => (
          <div
            key={i}
            className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Page ${i + 1}`} className="block h-auto w-full" />
          </div>
        ))}
        {pageImages && pageImages.length > 0 && (
          <p className="pb-2 text-xs text-slate-400">
            — Page 1 / {pageImages.length} —
          </p>
        )}
      </div>
    </div>
  );
}
