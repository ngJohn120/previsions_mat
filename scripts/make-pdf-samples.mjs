// Render impression + PDF samples for the demo fiches via local Chrome.
// Produces: docs/out/prevision-*.pdf (draft with watermark + submitted clean)
// Run: node scripts/make-pdf-samples.mjs
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL ?? process.env.PDF_BASE_URL ?? "http://localhost:3001";
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = "docs/out";
mkdirSync(OUT_DIR, { recursive: true });

// Auto-discover the demo fiche per section (no hardcoded UUIDs — the demo seed
// regenerates IDs on every run). Requires `node scripts/seed-demo.mjs` first.
async function discoverFiches() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await c
    .from("fiches")
    .select("id, attributions(classes(section, name))");
  if (error) throw error;
  const out = {};
  for (const f of data ?? []) {
    const section = f.attributions?.classes?.section;
    if (section && !out[section]) out[section] = f.id;
  }
  if (!out.primaire || !out.secondaire) {
    throw new Error(
      "Could not find a fiche for both primaire and secondaire — run `node scripts/seed-demo.mjs` first."
    );
  }
  return { primary: out.primaire, secondary: out.secondaire };
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.type("#email", email);
  await page.type("#password", "Test1234!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1800));
}

async function fetchPdf(cookies, ficheId, scale = 1) {
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${BASE}/impression/${ficheId}/pdf?scale=${scale}`, {
    headers: { cookie: cookieStr },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const FICHES = await discoverFiches();
  console.log("fiches:", FICHES);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  // ---- Primary teacher (draft → watermark) ----
  let ctx = await browser.createBrowserContext();
  let page = await ctx.newPage();
  await login(page, "m.mbuyi@siloe.edu");
  const primCookies = await page.cookies(`${BASE}/`);
  const p1 = await fetchPdf(primCookies, FICHES.primary, 1);
  writeFileSync(`${OUT_DIR}/prevision-primaire-brouillon-v2.pdf`, p1);
  console.log("primary draft PDF v2", p1.length, "bytes");
  try { writeFileSync(`${OUT_DIR}/prevision-primaire-brouillon.pdf`, p1); } catch { /* may be open in viewer */ }

  // ---- Secondary teacher (draft → watermark) ----
  ctx = await browser.createBrowserContext();
  page = await ctx.newPage();
  await login(page, "m.kazadi@siloe.edu");
  const secCookies = await page.cookies(`${BASE}/`);
  const p2 = await fetchPdf(secCookies, FICHES.secondary, 1);
  writeFileSync(`${OUT_DIR}/prevision-secondaire-brouillon.pdf`, p2);
  console.log("secondary draft PDF", p2.length, "bytes");

  // Submit the secondary fiche (via Supabase REST with anon key + user cookie)
  // so we can produce a clean (no watermark) sample. Requires the fiche to be
  // complete; demo seed only fills 3 rows, so completeness gate will fail —
  // instead we bypass by marking soumise via service role (dev only).
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (SUPABASE_URL && SERVICE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_fiche`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_fiche_id: FICHES.secondary }),
    }).then((r) => console.log("submit_fiche (secondary) status:", r.status));
  }

  // Render clean (submitted → no watermark) secondary PDF
  const secCookies2 = await page.cookies(`${BASE}/`);
  const p3 = await fetchPdf(secCookies2, FICHES.secondary, 1);
  writeFileSync(`${OUT_DIR}/prevision-secondaire-soumise.pdf`, p3);
  console.log("secondary submitted PDF", p3.length, "bytes");

  // Render the secondary impression page (HTML) to confirm sheet count
  await page.goto(`${BASE}/impression/${FICHES.secondary}`, { waitUntil: "networkidle0" });
  const secSheets = await page.$$eval(".sheet", (els) => els.length);
  console.log("secondary sheet count:", secSheets);

  await browser.close();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
