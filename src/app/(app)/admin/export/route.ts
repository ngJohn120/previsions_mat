import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, adminSections } from "@/lib/auth";
import { listSuiviFiches } from "@/lib/fiche";

export const dynamic = "force-dynamic";

/**
 * Export all fiches of the admin's section/year as CSV (RLS-scoped).
 * Super admin: all sections. Section admin: own section.
 * GET /admin/export?yearId=...
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const sections = adminSections(user.roles);
  if (sections.length === 0) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const supabase = await createClient();
  let yearId = req.nextUrl.searchParams.get("yearId");
  if (!yearId) {
    // fallback: the top-bar switcher year (pm_year cookie), else active year
    const cookieYear = req.cookies.get("pm_year")?.value;
    if (cookieYear) {
      const { data: picked } = await supabase
        .from("school_years")
        .select("id")
        .eq("id", cookieYear)
        .limit(1)
        .maybeSingle();
      if (picked) yearId = picked.id;
    }
  }
  if (!yearId) {
    const { data: active } = await supabase
      .from("school_years")
      .select("id")
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    yearId = active?.id ?? null;
    if (!yearId) return NextResponse.json({ error: "Aucune année active" }, { status: 400 });
  }

  const fiches = await listSuiviFiches(yearId ?? "", sections);

  // Build rows: one line per fiche with metadata + first N cells flattened.
  const header = [
    "Section", "Classe", "Cours", "Sous-branche", "Enseignant",
    "État", "Progression %", "Soumise le", "Conflit", "Demande en attente",
  ];
  const lines = fiches.map((f) => [
    f.section === "primaire" ? "Primaire" : "Secondaire",
    f.classe,
    f.cours,
    f.sousBranche ?? "",
    f.enseignant,
    f.statut === "soumise" ? "soumise" : "brouillon",
    String(f.progression),
    f.submittedAt ?? "",
    f.conflit ? "oui" : "",
    f.hasPendingUnlock ? "oui" : "",
  ]);

  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [header, ...lines].map((row) => row.map(esc).join(",")).join("\r\n");

  const filename = `export-fiches-${yearId ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
