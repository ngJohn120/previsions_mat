// Smoke test: login as admin, verify notifications page + admin/export CSV + admin/suivi.
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Auto-discover IDs so the test works on any freshly seeded local DB.
async function discoverIds() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: year } = await c.from("school_years").select("id").eq("status", "active").limit(1);
  const { data: fiche } = await c.from("fiches").select("id").limit(1);
  return { yearId: year?.[0]?.id, ficheId: fiche?.[0]?.id };
}

async function main() {
  const { yearId, ficheId } = await discoverIds();
  if (!yearId || !ficheId) {
    console.error("ERR: no active year or fiche in local DB — run `node scripts/seed-demo.mjs` first");
    process.exit(1);
  }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "direction@siloe.edu");
  await page.type("#password", "Test1234!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1800));

  // Notifications page
  const notifRes = await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle0" });
  const notifText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log("notifications:", notifRes.status(), JSON.stringify(notifText.slice(0, 120)));

  // Admin suivi
  const suiviRes = await page.goto(`${BASE}/admin/suivi`, { waitUntil: "networkidle0" });
  const suiviText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("suivi:", suiviRes.status(), JSON.stringify(suiviText.slice(0, 200)));

  // Export CSV
  const cookies = await page.cookies(`${BASE}/`);
  const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const csvRes = await fetch(`${BASE}/admin/export?yearId=${yearId}`, {
    headers: { cookie: cookieStr },
  });
  const csvText = await csvRes.text();
  console.log("export:", csvRes.status, "ct:", csvRes.headers.get("content-type"), "| first line:", JSON.stringify(csvText.split("\n")[0]?.slice(0, 80)));

  // Impression — new Python-rendered PNG preview (no HTML .sheet grid anymore)
  const impRes = await page.goto(`${BASE}/impression/${ficheId}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 8000)); // wait for Python rasterization (~5s)
  const imgCount = await page.$$eval("img[src^='data:image/png']", (els) => els.length);
  console.log("impression:", impRes.status(), "png pages:", imgCount);

  await browser.close();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
