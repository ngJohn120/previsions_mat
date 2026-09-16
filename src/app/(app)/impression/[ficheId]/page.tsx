import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { titleForSection } from "@/lib/school";
import { PdfDownloadButton } from "@/components/print/pdf-download-button";
import { PdfPreview } from "@/components/print/pdf-preview";

export const dynamic = "force-dynamic";

/**
 * Aperçu impression — le rendu officiel (ReportLab) est affiché côté client
 * à partir du PDF protégé /impression/[ficheId]/pdf (composant PdfPreview).
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

      {/* Pages du document — rendu client du PDF officiel (PDF.js) */}
      <PdfPreview ficheId={ficheId} />
    </div>
  );
}