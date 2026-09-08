// PWA check: verify the service worker registers/activates and the web manifest
// loads at /manifest.webmanifest — corresponds to TESTING.md step 1 (PWA line).
// Run: node scripts/check-pwa.mjs          (server must be running)
//      BASE_URL=http://localhost:3002 node scripts/check-pwa.mjs
import puppeteer from "puppeteer-core";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EMAIL = "m.mbuyi@siloe.edu"; // teacher account from docs/TESTING.md

async function main() {
  const manRes = await fetch(`${BASE}/manifest.webmanifest`);
  const manText = await manRes.text();
  console.log("manifest status:", manRes.status, "ct:", manRes.headers.get("content-type"));
  console.log("manifest name:", JSON.stringify((JSON.parse(manText).name || "").slice(0, 60)));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.type("#email", EMAIL);
  await page.type("#password", "Test1234!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForSelector('a[aria-label="Notifications"]', { timeout: 120000 });
  console.log("logged in, path:", new URL(page.url()).pathname);

  // Wait for SW registration to settle (register + activate happens shortly after load)
  await new Promise((r) => setTimeout(r, 4000));
  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      supported: true,
      count: regs.length,
      regs: regs.map((r) => ({
        scope: r.scope,
        active: r.active ? r.active.scriptURL : null,
        state: r.active ? r.active.state : null,
      })),
      controller: !!navigator.serviceWorker.controller,
    };
  });
  console.log("SW:", JSON.stringify(sw, null, 2));

  const manifestLink = await page.evaluate(() => {
    const l = document.querySelector('link[rel="manifest"]');
    return l ? l.getAttribute("href") : null;
  });
  console.log("manifest link href:", manifestLink);

  const ok =
    manRes.status === 200 &&
    sw.supported === true &&
    sw.count >= 1 &&
    sw.regs.some((r) => r.state === "activated" && r.scope === `${BASE}/`) &&
    manifestLink === "/manifest.webmanifest";
  console.log(ok ? "PWA CHECK: PASS" : "PWA CHECK: FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
