import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { generateFichePdf } from "@/lib/print-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF endpoint — génère le PDF officiel (ReportLab/Python) pour une fiche.
 * L'accès est vérifié côté serveur (RLS via getFicheForUser) avant d'appeler
 * le script Python (qui, lui, utilise la clé service pour lire les données).
 * Usage: /impression/[ficheId]/pdf
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ficheId: string }> }
) {
  const { ficheId } = await params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Vérifier que l'utilisateur a accès à cette fiche avant de générer le PDF.
  const data = await getFicheForUser(ficheId);
  if (!data) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  try {
    const pdf = await generateFichePdf(ficheId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="prevision-${ficheId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur PDF" },
      { status: 500 }
    );
  }
}
