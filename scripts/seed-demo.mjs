// One-off demo seed: classes, branches, active templates + attributions +
// draft fiches with sample content for the 2026–2027 school year.
// Run: node scripts/seed-demo.mjs
//
// Uses the same calendar logic as the app (buildWeeks + generateRowsForSection)
// so the fiche rows match what the admin calendar UI would produce.
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const c = createClient(url, key, { auth: { persistSession: false } });

const YEAR_ID = "ec5ef256-9bba-42a9-bc46-e56db21ec9aa";
const TEACHERS = {
  prim: "6075c061-9447-46ce-a726-9405238251c2", // Mbuyi Kabongo
  sec: "5111ecda-4fec-4a69-9454-47d78e4c6112",   // Kazadi Mutombo
};

// ---------- minimal calendar helpers (mirror src/lib/calendar.ts) ----------
const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const fmt = (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;

function buildWeeks(start, end) {
  const weeks = [];
  let cursor = new Date(start);
  let num = 1;
  while (cursor <= end) {
    const weekStart = new Date(cursor);
    let weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 4);
    if (weekEnd > end) weekEnd = new Date(end);
    weeks.push({ semaine_num: num, start: weekStart, end: weekEnd, mois: MONTHS_FR[weekStart.getMonth()] });
    num++;
    cursor = new Date(weekEnd);
    cursor.setDate(cursor.getDate() + 3);
  }
  return weeks;
}

function generateRows(startISO, endISO, events = [], withPeriods = false) {
  const weeks = buildWeeks(new Date(startISO), new Date(endISO));
  const rows = [];
  const evs = events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) })).sort((a,b) => a.start - b.start);
  let evIdx = 0;
  for (const w of weeks) {
    while (evIdx < evs.length && evs[evIdx].start < w.start) {
      const ev = evs[evIdx];
      rows.push({ row_type: "evenement", ordre: rows.length + 1, mois: null, semaine_num: null, date_label: `${fmt(ev.start)} → ${fmt(ev.end)}`, periode_label: ev.label, evenement_label: ev.type });
      evIdx++;
    }
    rows.push({ row_type: "enseignement", ordre: rows.length + 1, mois: w.mois, semaine_num: w.semaine_num, date_label: `${fmt(w.start)} → ${fmt(w.end)}`, periode_label: null, evenement_label: null });
  }
  while (evIdx < evs.length) {
    const ev = evs[evIdx];
    rows.push({ row_type: "evenement", ordre: rows.length + 1, mois: null, semaine_num: null, date_label: `${fmt(ev.start)} → ${fmt(ev.end)}`, periode_label: ev.label, evenement_label: ev.type });
    evIdx++;
  }
  return rows;
}

function sampleContent(rows, colSeed) {
  let teachingCount = 0;
  return rows.map((r) => {
    if (r.row_type !== "enseignement") return r;
    teachingCount++;
    // Fill first 3 teaching rows so drafts show some content + progression
    if (teachingCount > 3) return r;
    const cells = {};
    if (colSeed.matieres) cells.matieres = `${colSeed.matieres} — leçon ${teachingCount}`;
    if (colSeed.ref) cells.ref = `Manuel p. ${4 + teachingCount * 2}`;
    if (colSeed.intention) cells.intention = `Savoir ${colSeed.intention.toLowerCase()} (semaine ${teachingCount})`;
    if (colSeed.heure) cells.heure = String(colSeed.heure);
    if (colSeed.mv) cells.mv = teachingCount === 1 ? "Notions de base" : "";
    return { ...r, cells };
  });
}

async function main() {
  // ---- Reset prior demo seed (idempotent-ish re-run) ----
  await c.from("template_versions").delete().eq("school_year_id", YEAR_ID);
  await c.from("classes").delete().eq("school_year_id", YEAR_ID);
  await c.from("branches").delete().in("name", ["Français", "Mathématiques"]);

  // ---- Branches ----
  const { data: fr } = await c.from("branches").insert({ name: "Français", sections: ["primaire","secondaire"] }).select("id");
  const frId = fr?.[0]?.id;
  const { data: math } = await c.from("branches").insert({ name: "Mathématiques", sections: ["primaire","secondaire"] }).select("id");
  const mathId = math?.[0]?.id;
  const { data: gram } = frId ? await c.from("sous_branches").insert({ branche_id: frId, name: "Grammaire" }).select("id") : { data: null };
  const gramId = gram?.[0]?.id;

  // ---- Classes ----
  const cls = [];
  for (const [name, level, section, ordre] of [
    ["6e B", "6e", "primaire", 1],
    ["3e", "3e", "secondaire", 1],
  ]) {
    const { data } = await c.from("classes").insert({ school_year_id: YEAR_ID, section, name, level, ordre }).select("id");
    if (data?.[0]) cls.push({ id: data[0].id, section, name });
  }
  const clsPrim = cls.find((x) => x.section === "primaire");
  const clsSec = cls.find((x) => x.section === "secondaire");

  // ---- Active templates ----
  const events = [
    { label: "1re évaluation · détente", type: "evaluation", start: "2026-11-02", end: "2026-11-06" },
    { label: "Vacances de Noël", type: "vacances", start: "2026-12-23", end: "2027-01-09" },
    { label: "Révision + examens 1er trimestre", type: "examen", start: "2027-01-25", end: "2027-02-06" },
    { label: "Vacances de Pâques", type: "vacances", start: "2027-03-29", end: "2027-04-03" },
    { label: "Examens de fin d'année", type: "examen", start: "2027-06-21", end: "2027-07-02" },
  ];
  const primaryRows = generateRows("2026-09-01", "2027-07-02", events);
  const secondaryRows = generateRows("2026-09-01", "2027-06-11", events);

  const { data: tvP } = await c.from("template_versions").insert({ school_year_id: YEAR_ID, section: "primaire", version: 1, is_active: true }).select("id");
  const { data: tvS } = await c.from("template_versions").insert({ school_year_id: YEAR_ID, section: "secondaire", version: 1, is_active: true }).select("id");

  const seedRows = async (tplId, rows) => {
    const uuid = () => crypto.randomUUID();
    for (const r of rows) {
      await c.from("template_rows").insert({
        template_version_id: tplId, row_uuid: uuid(), ordre: r.ordre, row_type: r.row_type,
        mois: r.mois, semaine_num: r.semaine_num, date_label: r.date_label,
        periode_label: r.periode_label, evenement_label: r.evenement_label,
      });
    }
  };

  if (tvP?.[0]) await seedRows(tvP[0].id, primaryRows);
  if (tvS?.[0]) await seedRows(tvS[0].id, secondaryRows);

  // ---- Attributions + fiches (sample content on first teaching rows) ----
  const { data: tplRowsP } = await c.from("template_rows").select("*").eq("template_version_id", tvP?.[0]?.id).order("ordre");
  const { data: tplRowsS } = await c.from("template_rows").select("*").eq("template_version_id", tvS?.[0]?.id).order("ordre");

  const createFiche = async ({ classeId, section, brancheId, sousId, enseignantId, tplRows, seed }) => {
    const { data: attr } = await c.from("attributions").insert({
      school_year_id: YEAR_ID, classe_id: classeId, branche_id: brancheId, sous_branche_id: sousId ?? null, enseignant_id: enseignantId,
    }).select("id").maybeSingle();
    if (!attr) return;
    const { data: fiche } = await c.from("fiches").insert({
      attribution_id: attr.id, school_year_id: YEAR_ID, statut: "brouillon",
    }).select("id").maybeSingle();
    if (!fiche) return;
    const content = sampleContent(tplRows ?? [], seed);
    for (const tr of content) {
      const { data: row } = await c.from("fiche_rows").insert({
        fiche_id: fiche.id, row_uuid: tr.row_uuid ?? crypto.randomUUID(), ordre: tr.ordre, row_type: tr.row_type,
        mois: tr.mois, semaine_num: tr.semaine_num, date_label: tr.date_label,
        periode_label: tr.periode_label, evenement_label: tr.evenement_label,
      }).select("id").maybeSingle();
      if (row && tr.row_type === "enseignement") {
        const cellRows = ["matieres","ref","intention","obs","heure","mv"].map((k) => ({
          fiche_row_id: row.id, col_key: k, value: tr.cells?.[k] ?? "",
        }));
        await c.from("fiche_cells").insert(cellRows);
      }
    }
    console.log("fiche created for", classeId, brancheId);
  };

  if (clsPrim && tvP?.[0]) {
    await createFiche({ classeId: clsPrim.id, section: "primaire", brancheId: frId, sousId: gramId, enseignantId: TEACHERS.prim, tplRows: tplRowsP, seed: { matieres: "Grammaire — la phrase", ref: "Manuel de grammaire", intention: "Identifier la phrase simple" } });
  }
  if (clsSec && tvS?.[0]) {
    await createFiche({ classeId: clsSec.id, section: "secondaire", brancheId: mathId, sousId: null, enseignantId: TEACHERS.sec, tplRows: tplRowsS, seed: { matieres: "Nombres entiers — rappels", ref: null, intention: null, heure: 4, mv: true } });
  }

  console.log("Seed done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
