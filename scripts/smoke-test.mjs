// Smoke test: login as admin, verify notifications page + admin/export CSV + admin/suivi.
import puppeteer from "puppeteer-core";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
const BASE = "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
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
  const csvRes = await fetch(`${BASE}/admin/export?yearId=ec5ef256-9bba-42a9-bc46-e56db21ec9aa`, {
    headers: { cookie: cookieStr },
  });
  const csvText = await csvRes.text();
  console.log("export:", csvRes.status, "ct:", csvRes.headers.get("content-type"), "| first line:", JSON.stringify(csvText.split("\n")[0]?.slice(0, 80)));

  // Impression (teacher view would differ; super admin can view via can_access_fiche)
  const impRes = await page.goto(`${BASE}/impression/a36014d8-25fa-45b9-97ad-5ce938bfa469`, { waitUntil: "networkidle0" });
  const sheetCount = await page.$$eval(".sheet", (els) => els.length);
  console.log("impression:", impRes.status(), "sheets:", sheetCount);

  await browser.close();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
