// Diagnostic: measure print layout of the impression page (2 sheets expected).
import puppeteer from "puppeteer-core";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.emulateMediaType("print");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", "m.mbuyi@siloe.edu");
  await page.type("#password", "Test1234!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));

  await page.goto(`${BASE}/impression/a36014d8-25fa-45b9-97ad-5ce938bfa469`, { waitUntil: "networkidle0" });
  const info = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll(".sheet")];
    const css = getComputedStyle(document.querySelector(".sheet"));
    const pdfPage = { w: 1122, h: 793 }; // A4 landscape @96dpi approx
    return {
      sheetCount: sheets.length,
      sheetWidth: sheets[0]?.getBoundingClientRect().width,
      sheetHeight: sheets[0]?.getBoundingClientRect().height,
      sheetCSSWidth: css.width,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollH: document.body.scrollHeight,
      pageRule: [...document.styleSheets].flatMap((s) => {
        try { return [...s.cssRules].filter((r) => r.type === CSSRule.PAGE_RULE).map((r) => r.cssText); } catch { return []; }
      }),
      mediaPrintSheets: (() => {
        for (const s of document.styleSheets) {
          try {
            for (const r of s.cssRules) {
              if (r.media?.mediaText?.includes("print")) {
                const txt = r.cssText;
                if (txt.includes(".sheet")) return txt.slice(0, 300);
              }
            }
          } catch {}
        }
        return "not found";
      })(),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
