// Read-only UI check for the 'admin' role consolidation (migration 0018).
// Verifies: role options in the users modal, role labels per account, and that
// a section admin still reaches their admin pages. No writes.
// Run: node scripts/verify-admin-role.mjs   (dev server on :3001 required)
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const CHROME =
  [process.env.CHROME_PATH,
    "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
    .find((p) => p && existsSync(p)) ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.type("#email", email);
  await page.type("#password", "Test1234!");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "pm-role-check-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`],
  });

  try {
    // ---- Super admin: users page + modal role options ----
    let ctx = await browser.createBrowserContext();
    let page = await ctx.newPage();
    await login(page, "direction@siloe.edu");
    await page.goto(`${BASE}/admin/utilisateurs`, { waitUntil: "networkidle0", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 3000));

    const rowCount = await page.$$eval("tbody tr", (rows) => rows.length).catch(() => 0);
    check("users table renders rows", rowCount > 0, `${rowCount} rows`);

    const adminPills = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].filter((tr) => /\bAdmin\b/.test(tr.innerText)).length
    );
    check("an 'Admin' pill is rendered (no old names)", adminPills >= 1, `${adminPills} row(s)`);

    const oldNames = await page.evaluate(() => /Admin primaire|Admin secondaire/.test(document.body.innerText));
    check("no 'Admin primaire/secondaire' text on the page", !oldNames);

    // Open the create dialog and read the ROLE select (the one offering 'enseignant')
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Ajouter|Nouveau|Nouvel utilisateur/i.test(b.textContent ?? ""));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 800));
    if (opened) {
      const options = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const scopes = dialog ? [dialog, document] : [document];
        for (const scope of scopes) {
          const sel = [...scope.querySelectorAll("select")].find((s) =>
            [...s.options].some((o) => o.value === "enseignant")
          );
          if (sel && ![...sel.options].some((o) => o.value === "all")) {
            return [...sel.options].map((o) => o.value);
          }
        }
        return [];
      });
      check("role select offers exactly Enseignant/Admin/Super admin",
        JSON.stringify(options) === JSON.stringify(["enseignant", "admin", "super_admin"]),
        options.join(", "));
      await page.keyboard.press("Escape"); // close dialog — no writes happened
    } else {
      check("role select offers exactly Enseignant/Admin/Super admin", false, "dialog button not found");
    }
    await ctx.close();

    // ---- Section admin primaire: still functional + correct label ----
    ctx = await browser.createBrowserContext();
    page = await ctx.newPage();
    await login(page, "admin.prim@siloe.edu");
    const labelPrim = await page.evaluate(() => document.body.innerText);
    check("admin.prim label shows « Administrateur · Primaire »", /Administrateur · Primaire/.test(labelPrim));
    const suivi = await page.goto(`${BASE}/admin/suivi`, { waitUntil: "networkidle0", timeout: 90000 }).catch(() => null);
    check("admin.prim reaches /admin/suivi", suivi ? suivi.status() === 200 : false, suivi ? `HTTP ${suivi.status()}` : "nav failed");
    await ctx.close();

    // ---- Section admin secondaire: correct label ----
    ctx = await browser.createBrowserContext();
    page = await ctx.newPage();
    await login(page, "admin.sec@siloe.edu");
    const labelSec = await page.evaluate(() => document.body.innerText);
    check("admin.sec label shows « Administrateur · Secondaire »", /Administrateur · Secondaire/.test(labelSec));
    await ctx.close();
  } catch (e) {
    check("execution without exception", false, String(e).slice(0, 300));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });