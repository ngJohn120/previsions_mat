// Verify the /secondaire/attributions modal comments:
//   1) « Cours (branche) » block renders ABOVE « Classes »
//   2) the Classes choices reflect the subject→class link made on /admin/branches
//   3) a cours linked to 2 grades + assigning in ONE go creates one attribution
//      (+ fiche) per ticked class — décision 2026-10-14 (comment #70d059)
// Run: node scripts/verify-attributions-modal.mjs   (dev server on :3001 required)
// Creates temporary secondaire classes + branches, then removes everything.
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

/** Checkbox group under a dialog label (Classes / Sous-branches / …). */
async function readGroup(page, labelText) {
  return page.evaluate((t) => {
    const dlgs = document.querySelectorAll('[role="dialog"]');
    const dlg = dlgs[dlgs.length - 1];
    const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
    if (!label) return null;
    const boxes = [...label.parentElement.querySelectorAll('input[type="checkbox"]')];
    return boxes.map((i) => ({
      text: i.parentElement.textContent.trim(),
      checked: i.checked,
      disabled: i.disabled,
    }));
  }, labelText);
}

/** Click one checkbox of a dialog group (real in-page click: React listens). */
async function tickBox(page, labelText, textStartsWith) {
  return page.evaluate((t, s) => {
    const dlgs = document.querySelectorAll('[role="dialog"]');
    const dlg = dlgs[dlgs.length - 1];
    const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
    if (!label) return "no-group";
    const box = [...label.parentElement.querySelectorAll('input[type="checkbox"]')].find((i) =>
      i.parentElement.textContent.trim().startsWith(s)
    );
    if (!box) return "not-found";
    box.click();
    return box.checked;
  }, labelText, textStartsWith);
}

async function selectedOption(page, labelText) {
  return page.evaluate((t) => {
    const dlgs = document.querySelectorAll('[role="dialog"]');
    const dlg = dlgs[dlgs.length - 1];
    const label = [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
    const sel = label?.parentElement?.querySelector("select");
    return sel ? sel.selectedOptions[0]?.textContent?.trim() ?? "" : null;
  }, labelText);
}

const TEMP_A = "Test 4e (temporaire)";
const TEMP_B = "Test 5e (temporaire)";
const TEMP_BRANCH = "ZZ Cours sans lien (temporaire)";
const TEMP_BRANCH2 = "ZZ Cours 2 classes (temporaire)";
let tempClassA = null;
let tempClassB = null;
let tempBranchId = null;
let tempBranch2Id = null;
let mathId = null;
let createdAttrIds = [];

async function main() {
  // ---------- fixtures: two temp secondaire classes; a temp unlinked branch
  // (every class offered), a temp branch linked to BOTH temp classes with no
  // sous-branche (the 2-grades case), and Maths linked to class A only ----------
  const { data: year } = await db.from("school_years").select("id").eq("status", "active").single();
  const { data: clsA, error: clsAErr } = await db
    .from("classes")
    .insert({ school_year_id: year.id, section: "secondaire", name: TEMP_A, level: "4e", ordre: 90 })
    .select("id")
    .single();
  if (clsAErr) throw new Error("temp class A: " + clsAErr.message);
  tempClassA = clsA.id;
  const { data: clsB, error: clsBErr } = await db
    .from("classes")
    .insert({ school_year_id: year.id, section: "secondaire", name: TEMP_B, level: "5e", ordre: 91 })
    .select("id")
    .single();
  if (clsBErr) throw new Error("temp class B: " + clsBErr.message);
  tempClassB = clsB.id;
  const { data: tbr, error: tbrErr } = await db
    .from("branches")
    .insert({ name: TEMP_BRANCH, sections: ["secondaire"] })
    .select("id")
    .single();
  if (tbrErr) throw new Error("temp branch: " + tbrErr.message);
  tempBranchId = tbr.id;
  const { data: tbr2, error: tbr2Err } = await db
    .from("branches")
    .insert({ name: TEMP_BRANCH2, sections: ["secondaire"] })
    .select("id")
    .single();
  if (tbr2Err) throw new Error("temp branch 2: " + tbr2Err.message);
  tempBranch2Id = tbr2.id;
  const { data: math } = await db.from("branches").select("id").eq("name", "Mathématiques").single();
  mathId = math.id;
  const { error: linkErr } = await db.from("branch_classes").insert([
    { branche_id: mathId, classe_id: tempClassA },
    { branche_id: tempBranch2Id, classe_id: tempClassA },
    { branche_id: tempBranch2Id, classe_id: tempClassB },
  ]);
  if (linkErr) throw new Error("temp links: " + linkErr.message);
  console.log("fixtures: 2 temp classes + 2 temp branches + links created");

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

    // (1) Block order: Cours above Classes.
    const blockOrder = await page.evaluate(() => {
      const dlgs = document.querySelectorAll('[role="dialog"]');
      const dlg = dlgs[dlgs.length - 1];
      const get = (t) => [...dlg.querySelectorAll("label")].find((l) => l.textContent.trim() === t);
      const cours = get("Cours (branche)");
      const classe = get("Classes");
      if (!cours || !classe) return null;
      return { coursTop: Math.round(cours.getBoundingClientRect().top), classeTop: Math.round(classe.getBoundingClientRect().top) };
    });
    check("« Cours (branche) » is above « Classes »",
      blockOrder !== null && blockOrder.coursTop < blockOrder.classeTop,
      blockOrder ? `cours@${blockOrder.coursTop} < classes@${blockOrder.classeTop}` : "labels not found");

    // (2) Selecting Maths narrows Classes to the linked grade only (checked).
    await setSelect(page, "Cours (branche)", mathId);
    await new Promise((r) => setTimeout(r, 500));
    const mathGroup = await readGroup(page, "Classes");
    check("Classes offers ONLY the linked grade for Mathématiques",
      JSON.stringify((mathGroup ?? []).map((g) => g.text)) === JSON.stringify([TEMP_A]), (mathGroup ?? []).map((g) => g.text).join(" | "));
    check("the linked grade is ticked by default",
      (mathGroup ?? []).some((g) => g.text === TEMP_A && g.checked), JSON.stringify(mathGroup ?? []));

    // (3) A cours without links offers every class.
    await setSelect(page, "Cours (branche)", tempBranchId);
    await new Promise((r) => setTimeout(r, 500));
    const unlinkedGroup = await readGroup(page, "Classes");
    const unlinkedTexts = (unlinkedGroup ?? []).map((g) => g.text);
    check("an unlinked cours offers every class",
      unlinkedTexts.length >= 3 && unlinkedTexts.includes("3e") && unlinkedTexts.includes(TEMP_A) && unlinkedTexts.includes(TEMP_B),
      unlinkedTexts.join(" | "));

    // (4) The 2-grades case: branch linked to A + B, no sous-branche.
    //     Tick both grades, create once → one attribution per grade.
    await setSelect(page, "Cours (branche)", tempBranch2Id);
    await new Promise((r) => setTimeout(r, 500));
    const twoGroup = await readGroup(page, "Classes");
    check("Classes offers exactly the 2 linked grades",
      JSON.stringify((twoGroup ?? []).map((g) => g.text)) === JSON.stringify([TEMP_A, TEMP_B]), (twoGroup ?? []).map((g) => g.text).join(" | "));
    const bClick = await tickBox(page, "Classes", TEMP_B);
    await new Promise((r) => setTimeout(r, 300));
    const tickedGroup = await readGroup(page, "Classes");
    check("both grades are ticked in one dialog",
      bClick === true && (tickedGroup ?? []).every((g) => g.checked), JSON.stringify(tickedGroup ?? []));
    const teacherName = await selectedOption(page, "Enseignant");
    console.log("debug: cours selected =", await selectedOption(page, "Cours (branche)"), "| classes ticked =", JSON.stringify(tickedGroup));

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /Créer l'attribution/.test(b.textContent ?? ""));
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    // The dialog closes on full success, stays open with an error otherwise
    // (or a partial result). Dev server actions are slow: poll up to ~20s.
    let dlgState = { open: true, error: null, text: "" };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      dlgState = await page.evaluate(() => {
        const dlgs = document.querySelectorAll('[role="dialog"]');
        const dlg = dlgs[dlgs.length - 1];
        if (!dlg) return { open: false, error: null, text: "" };
        return {
          open: true,
          error: dlg.querySelector(".text-red-700")?.textContent?.trim() ?? null,
          text: (dlg.innerText ?? "").slice(-400),
        };
      });
      if (!dlgState.open || dlgState.error) break;
      const busy = await page.evaluate(() => {
        const dlgs = document.querySelectorAll('[role="dialog"]');
        const dlg = dlgs[dlgs.length - 1];
        return /Enregistrement/.test(dlg?.innerText ?? "");
      });
      if (!busy) break;
    }

    const { data: rows } = await db
      .from("attributions")
      .select("id, classe_id, sous_branche_id, enseignant_id")
      .eq("branche_id", tempBranch2Id)
      .eq("school_year_id", year.id);
    createdAttrIds = (rows ?? []).map((r) => r.id);
    const { data: rowCls } = await db.from("classes").select("id, name").in("id", [...new Set((rows ?? []).map((r) => r.classe_id))]);
    const clsName = (id) => (rowCls ?? []).find((c) => c.id === id)?.name ?? id;
    const rowClasses = (rows ?? []).map((r) => r.classe_id).sort();
    check("one attribution per ticked grade was created (2 rows, sous NULL)",
      (rows ?? []).length === 2 &&
        JSON.stringify(rowClasses) === JSON.stringify([tempClassA, tempClassB].sort()) &&
        (rows ?? []).every((r) => r.sous_branche_id === null),
      `${(rows ?? []).length} row(s) [${(rows ?? []).map((r) => clsName(r.classe_id)).join(", ")}]` +
        (dlgState.open ? ` — dialog open${dlgState.error ? `, error: ${dlgState.error}` : ""} :: ${dlgState.text}` : " — dialog closed"));

    const { data: teachers } = await db
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set((rows ?? []).map((r) => r.enseignant_id))]);
    const teacherOk = (teachers ?? []).length === 1 && teachers[0].full_name === teacherName;
    check("both grades go to the teacher shown in the dialog",
      teacherOk, `${teacherName ?? "?"} → ${(teachers ?? []).map((t) => t.full_name).join(", ") || "—"}`);

    const { data: fiches } = await db
      .from("fiches")
      .select("id, attribution_id")
      .in("attribution_id", createdAttrIds.length ? createdAttrIds : ["00000000-0000-0000-0000-000000000000"]);
    check("each new attribution got its fiche (or no active template)",
      (fiches ?? []).length === (rows ?? []).length || (fiches ?? []).length === 0,
      `${(fiches ?? []).length} fiche(s) for ${(rows ?? []).length} attribution(s)`);

    await page.keyboard.press("Escape");
    await ctx.close();
  } catch (e) {
    check("execution without exception", false, String(e).slice(0, 300));
  } finally {
    await browser.close();
    // ---------- cleanup: fiches → attributions → links → classes → branches ----------
    if (createdAttrIds.length) {
      await db.from("fiches").delete().in("attribution_id", createdAttrIds);
      await db.from("attributions").delete().in("id", createdAttrIds);
    }
    if (tempBranch2Id) await db.from("branch_classes").delete().eq("branche_id", tempBranch2Id);
    if (mathId && tempClassA) await db.from("branch_classes").delete().eq("branche_id", mathId).eq("classe_id", tempClassA);
    if (tempClassA) await db.from("classes").delete().eq("id", tempClassA);
    if (tempClassB) await db.from("classes").delete().eq("id", tempClassB);
    if (tempBranchId) await db.from("branches").delete().eq("id", tempBranchId);
    if (tempBranch2Id) await db.from("branches").delete().eq("id", tempBranch2Id);
    const { data: leftClasses } = await db.from("classes").select("id").in("name", [TEMP_A, TEMP_B]);
    const { data: leftBranches } = await db.from("branches").select("id").in("name", [TEMP_BRANCH, TEMP_BRANCH2]);
    const { data: leftAttrs } = await db.from("attributions").select("id").in("id", createdAttrIds.length ? createdAttrIds : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`cleanup: classes left = ${(leftClasses ?? []).length}, branches left = ${(leftBranches ?? []).length}, attributions left = ${(leftAttrs ?? []).length}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
