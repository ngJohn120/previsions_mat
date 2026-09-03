import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { splitPrintPages } from "@/lib/print";
import { PrimaryPrint } from "@/components/print/primary-print";
import { SecondaryPrint } from "@/components/print/secondary-print";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { titleForSection } from "@/lib/school";

export default async function ImpressionPage({
  params,
  searchParams,
}: {
  params: Promise<{ ficheId: string }>;
  searchParams: Promise<{ scale?: string }>;
}) {
  const { ficheId } = await params;
  const { scale } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await getFicheForUser(ficheId);
  if (!data) notFound();

  const pages = splitPrintPages(data.rows, data.meta.section);
  const statut = data.fiche.statut;
  const scaleNum = scale ? Math.min(1.6, Math.max(0.6, Number(scale) || 1)) : 1;

  return (
    <div className="print-root">
      <PrintToolbar
        ficheId={ficheId}
        editorHref={`/fiche/${ficheId}`}
        title={`Aperçu impression · ${titleForSection(data.meta.section)} — ${data.meta.section === "primaire" ? "Primaire" : "Secondaire"}`}
        statut={statut}
        scale={scaleNum}
      />

      {/* Hint */}
      <div className="no-print mx-auto max-w-[900px] px-4 pt-3 text-center text-xs text-slate-400">
        Reproduction fidèle du formulaire papier (A4 paysage, {pages.length} page{pages.length > 1 ? "s" : ""}). Les brouillons portent un filigrane « BROUILLON ». Pour un vrai PDF : « Imprimer / PDF » → Enregistrer en PDF (orientation paysage), ou « Télécharger le PDF ».
      </div>

      {/* Sheets (scaled in preview; print uses natural CSS unless ?scale set) */}
      <div
        className="preview-wrap"
        style={scaleNum !== 1 ? { zoom: scaleNum } : undefined}
      >
        {data.meta.section === "primaire" ? (
          <PrimaryPrint pages={pages} meta={data.meta} statut={statut} />
        ) : (
          <SecondaryPrint pages={pages} meta={data.meta} statut={statut} />
        )}
      </div>
    </div>
  );
}
