// Verify the two /admin/branches comments (secondaire class links + section-box order).
// Run: node scripts/verify-branches-secondaire.mjs   (dev server on :3001 required)
// Asserts UI + DB, restores the branch's class links afterwards.
import puppeteer from "puppeteer-core";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const CHROME =
  [process.env.CHROME_PATH,
    "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
    .find((p) => p && existsSync(p)) ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

/** Open the "Modifier" modal of the row whose first cell matches `name`. */
async function openEditRow(page, name) {
  return page.evaluate((rowName) => {
    const row = [...document.querySelectorAll("tbody tr")].find(
      (tr) => tr.querySelector("td")?.textContent?.trim() === rowName
    );
    if (!row) return false;
    const btn = row.querySelector("td:last-child button");
    if (btn) { btn.click(); return true; }
    return false;
  }, name);
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "pm-branches-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`],
  });

  // Snapshot the branch's current class links so the test can restore them.
  const { data: before } = await db.from("branch_classes").select("branche_id, classe_id");
  const beforeSet = new Set((before ?? []).map((r) => `${r.branche_id}:${r.classe_id}`));

  try {
    // ---------- admin.sec ----------
    let ctx = await browser.createBrowserContext();
    let page = await ctx.newPage();
    await login(page, "admin.sec@siloe.edu");
    await page.goto(`${BASE}/admin/branches`, { waitUntil: "networkidle0", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));

    const opened = await openEditRow(page, "Mathématiques");
    check("modal opens (Mathématiques)", opened);
    await new Promise((r) => setTimeout(r, 700));

    // (2) Section checkboxes: own section first — Secondaire, Primaire.
    const sectionOrder = await page.evaluate(() => {
      const label = [...document.querySelectorAll('[role="dialog"] label')].filter((l) =>
        ["Primaire", "Secondaire"].includes(l.textContent.trim())
      );
      return label.map((l) => l.textContent.trim());
    });
    check("sections order = [Secondaire, Primaire] for a sec admin",
      JSON.stringify(sectionOrder) === JSON.stringify(["Secondaire", "Primaire"]), sectionOrder.join(", "));

    // (3) Block order: « Utilisable en » sits ABOVE « Nom de la branche ».
    const blockOrder = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const util = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === "Utilisable en");
      const nom = [...dlg.querySelectorAll("label")].find((l) =>
        ["Nom de la branche", "Nom de la matière"].includes(l.textContent.trim())
      );
      if (!util || !nom) return null;
      return { utilTop: Math.round(util.getBoundingClientRect().top), nomTop: Math.round(nom.getBoundingClientRect().top) };
    });
    check("« Utilisable en » is above « Nom de la branche »",
      blockOrder !== null && blockOrder.utilTop < blockOrder.nomTop,
      blockOrder ? `utilisable@${blockOrder.utilTop} < nom@${blockOrder.nomTop}` : "labels not found");

    // (1) The 'Classe' field is offered and lists secondaire classes.
    const hasClasseField = await page.evaluate(() =>
      /Classe \(optionnel\)/.test(document.querySelector('[role="dialog"]')?.textContent ?? "")
    );
    check("« Classe (optionnel) » field visible", hasClasseField);

    const classesOk = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const btn = [...dlg.querySelectorAll("button")].find((b) => /Partagée|▾/.test(b.textContent ?? ""));
      if (!btn) return null;
      btn.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 400));
    const classLabels = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return [...dlg.querySelectorAll("label")].map((l) => l.textContent.trim()).filter((t) => /^(6e B|3e)/.test(t));
    });
    check("picker lists the secondaire grade (3e) and not only primaire",
      classLabels.some((t) => t.includes("3e")), classLabels.join(" | ") || "no class labels matched");

    // Pick "3e", save, verify the link persisted (chip in the table).
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const lab = [...dlg.querySelectorAll("label")].find((l) => /^3e/.test(l.textContent.trim()));
      lab?.querySelector("input")?.click();
    });
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const save = [...dlg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Enregistrer");
      save?.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    // The list refreshes via the server action (~3-6 s in dev) — poll instead of a fixed wait.
    const gotChip = await page
      .waitForFunction(
        (rowName) => {
          const row = [...document.querySelectorAll("tbody tr")].find(
            (tr) => tr.querySelector("td")?.textContent?.trim() === rowName
          );
          return row ? /3e/.test(row.innerText) : false;
        },
        { timeout: 12000, polling: 500 },
        "Mathématiques"
      )
      .then(() => true)
      .catch(() => false);
    const afterSave = await page.evaluate((rowName) => {
      const row = [...document.querySelectorAll("tbody tr")].find(
        (tr) => tr.querySelector("td")?.textContent?.trim() === rowName
      );
      return row ? row.innerText : "";
    }, "Mathématiques");
    check("saved link shows in the Classe column (3e chip)", gotChip, afterSave.replace(/\n/g, " · ").slice(0, 120));

    const { data: mathRow } = await db.from("branches").select("id").eq("name", "Mathématiques").single();
    const { data: after } = await db.from("branch_classes").select("classe_id")
      .eq("branche_id", mathRow?.id ?? "");
    check("DB carries the secondaire class link", (after ?? []).length >= 1, `${(after ?? []).length} link(s)`);
    await ctx.close();

    // ---------- admin.prim: order stays [Primaire, Secondaire] ----------
    ctx = await browser.createBrowserContext();
    page = await ctx.newPage();
    await login(page, "admin.prim@siloe.edu");
    await page.goto(`${BASE}/admin/branches`, { waitUntil: "networkidle0", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));
    const openedPrim = await openEditRow(page, "Mathématiques");
    if (openedPrim) {
      await new Promise((r) => setTimeout(r, 700));
      const orderPrim = await page.evaluate(() => {
        const label = [...document.querySelectorAll('[role="dialog"] label')].filter((l) =>
          ["Primaire", "Secondaire"].includes(l.textContent.trim())
        );
        return label.map((l) => l.textContent.trim());
      });
      check("sections order = [Primaire, Secondaire] for a prim admin",
        JSON.stringify(orderPrim) === JSON.stringify(["Primaire", "Secondaire"]), orderPrim.join(", "));
      await page.keyboard.press("Escape");
    } else {
      check("sections order = [Primaire, Secondaire] for a prim admin", false, "modal not opened");
    }
    await ctx.close();
  } catch (e) {
    check("execution without exception", false, String(e).slice(0, 300));
  } finally {
    await browser.close();
    // Restore: remove every link this run added.
    const { data: now } = await db.from("branch_classes").select("branche_id, classe_id");
    const added = (now ?? []).filter((r) => !beforeSet.has(`${r.branche_id}:${r.classe_id}`));
    for (const r of added) {
      await db.from("branch_classes").delete().eq("branche_id", r.branche_id).eq("classe_id", r.classe_id);
    }
    console.log(`cleanup: removed ${added.length} added link(s)`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });