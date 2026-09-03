import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side PDF endpoint: renders the impression route headlessly with
 * Chrome via puppeteer-core and returns application/pdf.
 * Usage: /impression/[ficheId]/pdf?scale=1.0
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

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const url = _req.nextUrl.clone();
  url.pathname = `/impression/${ficheId}`;
  // scale: default 1; allow 0.6..1.6
  const scale = Math.min(1.6, Math.max(0.6, Number(url.searchParams.get("scale")) || 1));
  url.searchParams.set("scale", String(scale));
  url.searchParams.set("format", "a4");

  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = await import("puppeteer-core");
  } catch {
    return NextResponse.json(
      { error: "puppeteer-core non installé côté serveur" },
      { status: 500 }
    );
  }

  const chromePath =
    process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();

    // Forward auth cookies so the server-rendered impression route loads
    await page.setCookie(
      ...cookieStore.getAll().map((c) => ({
        name: c.name,
        value: c.value,
        domain: new URL(_req.nextUrl.origin).hostname,
        path: "/",
      }))
    );

    const target = `${_req.nextUrl.origin}${url.pathname}${url.search}`;
    const resp = await page.goto(target, { waitUntil: "networkidle0", timeout: 45000 });
    if (!resp || !resp.ok()) {
      await browser.close();
      return NextResponse.json({ error: "Page introuvable pour le PDF" }, { status: 404 });
    }

    // Scale handling: the impression page already zooms via data-print-scale;
    // for the PDF we additionally set the device scale factor so the sheet
    // fills A4 landscape width at the requested zoom.
    const pdf = await page.pdf({
      format: "a4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      scale,
    });

    await browser.close();

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="prevision-${ficheId}.pdf"`,
      },
    });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur PDF" },
      { status: 500 }
    );
  }
}
