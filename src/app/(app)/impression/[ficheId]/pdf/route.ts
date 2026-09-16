import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFicheForUser } from "@/lib/fiche";
import { generateFichePdf } from "@/lib/print-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF endpoint — génère le PDF officiel (ReportLab) pour une fiche.
 * L'accès est vérifié côté serveur (RLS via getFicheForUser) avant d'appeler
 * le renderer : la fiche autorisée est mappée vers un payload imprimable
 * signé (HMAC) envoyé au Vercel Python Function (ou au Python local).
 * Usage: /impression/[ficheId]/pdf
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ficheId: string }> }
) {
  const { ficheId } = await params;

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Vérifier que l'utilisateur a accès à cette fiche avant de générer le PDF.
  const fiche = await getFicheForUser(ficheId);
  if (!fiche) {
    return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  }

  try {
    const pdf = await generateFichePdf(fiche, req.nextUrl.origin);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="prevision-${ficheId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
      return NextResponse.json(
        { error: "Impossible de générer le PDF." },
        { status: 500 }
      );
    }
  }