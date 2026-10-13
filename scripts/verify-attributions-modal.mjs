// Verify the /secondaire/attributions modal comments:
//   1) « Cours (branche) » block renders ABOVE « Classe »
//   2) the Classe choices reflect the subject→class link made on /admin/branches
// Run: node scripts/verify-attributions-modal.mjs   (dev server on :3001 required)
// Creates a temporary secondaire class + link, then removes both.
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

/** Change a React-controlled <select> the way a user does: click to open the
 *  native picker, ArrowDown to the next option, Enter to commit. Synthetic
 *  value-setter/change events do not reach React 19's handler; this does. */
async function setSelect(page, labelText, value) {
  const read = () =>
    page.evaluate((t) => {
      const dlgs = document.querySelectorAll('[role="dialog"]');
      const dlg = dlgs[dlgs.length - 1];
      const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
      const sel = label?.parentElement?.querySelector("select");
      if (!sel) return null;
      return { value: sel.selectedOptions[0]?.value ?? null, options: [...sel.options].map((o) => o.value) };
    }, labelText);

  for (let i = 0; i < 12; i++) {
    const state = await read();
    if (!state) return false;
    if (state.value === value) return true;
    const target = state.options.indexOf(value);
    const current = state.options.indexOf(state.value ?? "");
    if (target === -1 || current === -1) return false;
    const box = await page.evaluate((t) => {
      const dlgs = document.querySelectorAll('[role="dialog"]');
      const dlg = dlgs[dlgs.length - 1];
      const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
      const sel = label?.parentElement?.querySelector("select");
      if (!sel) return null;
      const r = sel.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, labelText);
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    // Move the highlight by index delta (popups don't wrap in either direction).
    const down = target > current;
    for (let k = Math.abs(target - current); k > 0; k--) {
      await page.keyboard.press(down ? "ArrowDown" : "ArrowUp");
    }
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await read())?.value === value;
}

async function selectOptions(page, labelText) {
  return page.evaluate((labelText) => {
    const dlgs = document.querySelectorAll('[role="dialog"]');
    const dlg = dlgs[dlgs.length - 1];
    const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === labelText);
    const sel = label?.parentElement?.querySelector("select");
    return sel ? [...sel.options].map((o) => o.textContent.trim()) : null;
  }, labelText);
}

async function selectValue(page, labelText) {
  return page.evaluate((labelText) => {
    const dlgs = document.querySelectorAll('[role="dialog"]');
    const dlg = dlgs[dlgs.length - 1];
    const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === labelText);
    const sel = label?.parentElement?.querySelector("select");
    return sel ? sel.selectedOptions[0]?.textContent?.trim() ?? "" : null;
  }, labelText);
}

const TEMP_CLASS = "Test 4e (temporaire)";
const TEMP_BRANCH = "ZZ Cours sans lien (temporaire)";
let tempClassId = null;
let tempBranchId = null;
let mathId = null;

async function main() {
  // ---------- fixtures: a second secondaire class + a second class, a temp
  // unlinked branch, and Maths linked to the temp class ----------
  const { data: year } = await db.from("school_years").select("id").eq("status", "active").single();
  const { data: cls, error: clsErr } = await db
    .from("classes")
    .insert({ school_year_id: year.id, section: "secondaire", name: TEMP_CLASS, level: "4e", ordre: 90 })
    .select("id")
    .single();
  if (clsErr) throw new Error("temp class: " + clsErr.message);
  tempClassId = cls.id;
  const { data: tbr, error: tbrErr } = await db
    .from("branches")
    .insert({ name: TEMP_BRANCH, sections: ["secondaire"] })
    .select("id")
    .single();
  if (tbrErr) throw new Error("temp branch: " + tbrErr.message);
  tempBranchId = tbr.id;
  const { data: math } = await db.from("branches").select("id").eq("name", "Mathématiques").single();
  mathId = math.id;
  const { error: linkErr } = await db
    .from("branch_classes")
    .insert({ branche_id: mathId, classe_id: tempClassId });
  if (linkErr) throw new Error("temp link: " + linkErr.message);
  console.log("fixtures: temp class + temp branch + Mathématiques→Test 4e link created");

  const profile = mkdtempSync(join(tmpdir(), "pm-attr-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`],
  });

  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await login(page, "admin.sec@siloe.edu");
    await page.goto(`${BASE}/secondaire/attributions`, { waitUntil: "networkidle0", timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Nouvelle attribution/.test(b.textContent ?? ""));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // (1) Block order: Cours above Classe.
    const blockOrder = await page.evaluate(() => {
      const dlgs = document.querySelectorAll('[role="dialog"]');
      const dlg = dlgs[dlgs.length - 1];
      const get = (t) => [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
      const cours = get("Cours (branche)");
      const classe = get("Classe");
      if (!cours || !classe) return null;
      return { coursTop: Math.round(cours.getBoundingClientRect().top), classeTop: Math.round(classe.getBoundingClientRect().top) };
    });
    check("« Cours (branche) » is above « Classe »",
      blockOrder !== null && blockOrder.coursTop < blockOrder.classeTop,
      blockOrder ? `cours@${blockOrder.coursTop} < classe@${blockOrder.classeTop}` : "labels not found");

    // (2) Selecting Maths narrows Classe to the linked grade only.
    //     Read the state AFTER ensuring Maths is the selected cours (a no-op
    //     re-selection still leaves the already-filtered options in place).
    await setSelect(page, "Cours (branche)", mathId);
    await new Promise((r) => setTimeout(r, 500));
    const mathOptions = await selectOptions(page, "Classe");
    const mathValue = await selectValue(page, "Classe");
    check("Classe offers ONLY the linked grade for Mathématiques",
      JSON.stringify(mathOptions) === JSON.stringify([TEMP_CLASS]), (mathOptions ?? []).join(" | "));
    check("Classe selection follows the link", mathValue === TEMP_CLASS, mathValue ?? "—");

    // (3) A cours without links offers every class.
    await setSelect(page, "Cours (branche)", tempBranchId);
    await new Promise((r) => setTimeout(r, 500));
    const unlinkedOptions = await selectOptions(page, "Classe");
    check("an unlinked cours offers every class",
      (unlinkedOptions ?? []).length >= 2 && unlinkedOptions.includes("3e") && unlinkedOptions.includes(TEMP_CLASS),
      (unlinkedOptions ?? []).join(" | "));

    await page.keyboard.press("Escape");
    await ctx.close();
  } catch (e) {
    check("execution without exception", false, String(e).slice(0, 300));
  } finally {
    await browser.close();
    // ---------- cleanup: link first (FK), then the temp class + branch ----------
    if (mathId && tempClassId) {
      await db.from("branch_classes").delete().eq("branche_id", mathId).eq("classe_id", tempClassId);
      await db.from("classes").delete().eq("id", tempClassId);
    }
    if (tempBranchId) await db.from("branches").delete().eq("id", tempBranchId);
    const { data: leftClasses } = await db.from("classes").select("id").eq("name", TEMP_CLASS);
    const { data: leftBranches } = await db.from("branches").select("id").eq("name", TEMP_BRANCH);
    console.log(`cleanup: temp class rows left = ${(leftClasses ?? []).length}, temp branch rows left = ${(leftBranches ?? []).length}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });