# Phases 3–7 Implementation Plan — Fiche Editor, Offline Sync, Print & Oversight, Data Tools, Release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the remaining system on the Phase 1–2 foundation: the teacher fiche editor (primary/secondary) with submit/unlock workflow, the offline-first PWA sync engine, print-fidelity PDF output + admin-oversight screens, CSV import/data tools — all sorted locally first. Deployment to Vercel + production Supabase (Phase 7) is **on hold until the user gives the go** after local completion.

**Architecture:** Next.js App Router + Supabase (already scaffolded in Phases 1–2). Phase 3 adds the fiche editing UI reading/writing `fiche_rows`/`fiche_cells` with RPCs for submit/unlock; Phase 4 adds a PWA shell + IndexedDB local store/outbox + reconciliation; Phase 5 adds dedicated A4-landscape print routes/PDF (matching the paper PDFs) and the admin suivi/notifications screens; Phase 6 adds CSV import + fiche export; Phase 7 handles Vercel + production Supabase deployment with optional CI migrations.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, shadcn/ui, @supabase/supabase-js + @supabase/ssr (installed), date-fns, idb (IndexedDB helper), vitest (tests).

**Spec:** `docs/superpowers/specs/2026-09-02-previsions-matieres-design.md`
**Depends on:** Phases 1–2 (schema, RLS, roles, auth, structure, calendar/templates, attributions, rollover).

## Global Constraints

- French-only UI; code/docs English. Terminology binding: fiche, cours, branche, sous-branche, attribution; sections Primaire/Secondaire; approvers: Primaire → « le Directeur », Secondaire → « le Préfet / D.E. ».
- Work on `main`; **no auto-commits** — user approves each commit (commit after each task step 5).
- Dev on port **3001**; LAN via `LOCAL_LAN_HOST`.
- Mockups in `docs/mockups/` are binding: `02` dashboard, `03`/`04` editors, `05`/`14` print, `11` suivi, `12` notifications.
- Paper forms are A4 **landscape**; drafts print with a light **BROUILLON** watermark; submitted/archived print clean.
- Calendar/template rows carry stable `row_uuid`s; template edits after drafts create a new version applied manually (Phase 2 already does this); **submitted fiches never auto-update**.
- Status lifecycle: `brouillon` → (submit) → `soumise` → (unlock approved) → `brouillon`. Submission is atomic + validates completeness.
- Offline rule: every change persisted locally (IndexedDB) immediately; before-unload guard when unsynced ops exist; auto-resume sync on next launch.
- M.V. = « Matières vues » (confirmed); Heure stores a number; Réf is ~6.5 cm wide on print.
- Tests run via `npx vitest run`; typecheck via `npx tsc --noEmit`; build via `npm run build`.

---

# PHASE 3 — Fiche editor & workflow

### Task P3-1: Fiche data access helpers + RPCs (submit/unlock)

**Files:**
- Create: `supabase/migrations/0006_fiche_rpcs.sql` — `submit_fiche`, `request_unlock`, `approve_unlock`, `refuse_unlock`, `set_cell_value`, `create_fiche_from_template`
- Create: `src/lib/fiche.ts` — server helpers `getFiche(id)`, `getFicheForUser(id)`, `listFichesForUser(yearId)`

**Interfaces:**
- Produces Postgres functions (security definer, RLS-checked):
  - `submit_fiche(p_fiche_id uuid)` → validates completeness (all `enseignement` rows have required cells non-empty per section) and sets `statut='soumise'`, `submitted_at=now()`; logs to `activity_log`. Returns error if incomplete or already submitted.
  - `request_unlock(p_fiche_id uuid, p_motif text)` → inserts `unlock_requests` (`en_attente`) if none pending; logs.
  - `approve_unlock(p_request_id uuid)` → sets request `approuvee`, sets fiche back to `brouillon`; logs. Refuse = `refuse_unlock(p_request_id uuid)` → sets `refusee`.
  - `set_cell_value(p_cell_id uuid, p_value text, p_expected_version int)` → bumps `version`, records `updated_by`/`updated_at`, logs; returns error on version mismatch (used by sync later).
- Produces TS types: `FicheWithRows`, `FicheCellMap`, `getFicheForUser` returns the fiche + rows + cells only if the current user is the attribution teacher or an admin of the section.

- [ ] **Step 1: Write migration 0006** with the above SQL (RLS-checked security definer functions).
- [ ] **Step 2: Apply** `supabase db push`; verify functions exist via `supabase db query --linked "select proname from pg_proc where proname like '%fiche%'"`.
- [ ] **Step 3: `src/lib/fiche.ts`** server helpers (query rows/cells for a fiche, scoped by `can_access_fiche`).
- [ ] **Step 4: Typecheck + commit.**

### Task P3-2: Teacher dashboard (« Mes fiches ») — mockup 02

**Files:**
- Create: `src/app/(app)/enseignant/page.tsx` — server page listing the teacher's fiches (from their attributions), with stat cards, filters, progression bar.
- Create: `src/app/(app)/enseignant/actions.ts` — export CSV action.
- Create: `src/components/enseignant/fiche-list.tsx`, `src/components/enseignant/demande-modification-dialog.tsx`, `src/components/enseignant/conflit-dialog.tsx`

**Interfaces:**
- Consumes: `getFicheForUser` / list helpers; `request_unlock` RPC; conflict data (Phase 4 provides the conflict flag — stub for now reading a `conflit` boolean on fiche).
- Produces: dashboard matching mockup `02`: « Mes fiches », stat cards (total/brouillons/soumises/à compléter), table (classe, cours, sous-branche, état chip, progression %, dernière modif., actions), « Demander une modification » modal (motif → request_unlock), conflict modal (stub until P4), export CSV of the filtered list.

- [ ] **Step 1: Page + data** — list the current user's attributions joined with fiche/rows/cells; compute per-fiche progression (filled required cells / total teaching rows).
- [ ] **Step 2: Fiche-list table** with status chips (brouillon/soumise/demande/conflit), progression bars, action buttons.
- [ ] **Step 3: Demande-modification dialog** — calls `request_unlock`.
- [ ] **Step 4: Export CSV action**.
- [ ] **Step 5: Typecheck/build + commit.**

### Task P3-3: Primary editor (screen) — mockup 03

**Files:**
- Create: `src/app/(app)/fiche/[ficheId]/page.tsx` — server loads fiche (section-specific render)
- Create: `src/components/editor/primary-grid.tsx`, `src/components/editor/editor-toolbar.tsx`, `src/components/editor/completeness-bar.tsx`
- Create: `src/components/editor/cell.tsx` (client cell editing → `set_cell_value`)
- Create: `src/components/editor/print-preview-link.tsx`

**Interfaces:**
- Consumes: `getFicheForUser`, `set_cell_value`, `submit_fiche`.
- Produces: primary editor matching `03`: document header (top school line, centered « PRÉVISION ANNUELLE », metadata row incl. Sous-branche), month-grouped grid (each month its own group), weeks numbered with date ranges, columns Mois | Semaine — Date | Matières à enseigner | Réf. | Intention | Obs. (Réf ~6.5cm, Intention wide); required-field marking + completeness bar; « Soumettre » disabled until complete; « Aperçu impression » link → Phase 5 route.

- [ ] **Step 1: Cell component (client)** — contentEditable-ish controlled input calling `set_cell_value` (debounced) + optimistic update + version handling.
- [ ] **Step 2: Primary grid** — server renders rows grouped by `mois`; teaching rows editable cells, event rows as banded non-editable rows; required-field outline for missing required cells.
- [ ] **Step 3: Completeness bar** — % of required teaching cells filled.
- [ ] **Step 4: Submit action** — calls `submit_fiche`; shows validation errors if incomplete.
- [ ] **Step 5: Typecheck/build + commit.**

### Task P3-4: Secondary editor (screen) — mockup 04

**Files:**
- Create: `src/components/editor/secondary-grid.tsx` (reuses `cell.tsx`, `editor-toolbar.tsx`)
- Modify: `src/app/(app)/fiche/[ficheId]/page.tsx` — branch by section.

**Interfaces:**
- Consumes: same as P3-3.
- Produces: secondary editor matching `04`: header (school line + « PRÉVISION DES MATIÈRES » + metadata row: Section, Classe, Professeur, Branche); period separator bands (1re/2e/3e, gray) + golden event bands; columns N | Semaines | Heure | Matières prévues | M.V. | Obs. (Heure narrow, Matières prévues widest, **M.V. wide ≈ Matières vues**); required = Matières prévues + Heure; event rows non-editable.

- [ ] **Step 1: Secondary grid** (reuse cell + toolbar).
- [ ] **Step 2: Required/validation + completeness for secondary cols.**
- [ ] **Step 3: Submit wiring** (same as primary, section-aware completeness).
- [ ] **Step 4: Typecheck/build + commit.**

### Task P3-5: Read-only consult + admin approve/refuse (feeds oversight)

**Files:**
- Create: `src/app/(app)/fiche/[ficheId]/consultation/page.tsx` (read-only grid, no editing)
- Create: `src/components/admin/unlock-approval-buttons.tsx` (client, calls approve/refuse RPCs)

**Interfaces:**
- Consumes: `approve_unlock`/`refuse_unlock` RPCs; `getFicheForUser`.
- Produces: read-only fiche view for admins; approve/refuse buttons on pending unlock requests (visible only to super admin / section admin; not the requester).

- [ ] **Step 1: Read-only page** rendering the grid non-editable.
- [ ] **Step 2: Approve/refuse client buttons** calling the RPCs; refresh.
- [ ] **Step 3: Typecheck/build + commit.**

---

# PHASE 4 — Offline sync / PWA

### Task P4-1: PWA shell (manifest + service worker + offline bootstrap)

**Files:**
- Create: `src/app/manifest.ts` (Next App Router manifest)
- Create: `public/sw.js` (or Next 16 `service-worker` convention per bundled docs)
- Modify: `src/app/layout.tsx` (register SW), `src/proxy.ts` (no change needed for SW)

**Interfaces:**
- Produces: installable PWA; app shell cached; loads offline.

- [ ] **Step 1: Check Next 16 docs** under `node_modules/next/dist/docs/` for the current PWA/service-worker convention (deprecations), then implement manifest + SW registration accordingly.
- [ ] **Step 2: Verify** in dev: manifest served, SW registers, page loads with network offline.
- [ ] **Step 3: Commit.**

### Task P4-2: IndexedDB local store + sync queue (idb)

**Files:**
- Create: `src/lib/db.ts` (idb helpers — open DB, stores: `fiche_cache`, `outbox`)
- Create: `src/lib/sync/outbox.ts` (enqueue op, drain)
- Create: `src/lib/sync/types.ts` (SyncOp union: upsert row / update cell / transition)
- Create: `src/lib/sync/engine.ts` (push/pull, idempotency, versioning, conflict detection)

**Interfaces:**
- Produces:
  - `openDb(): Promise<IDBPDatabase>` with stores `fiche_cache` (key `ficheId`), `outbox` (auto-increment, key `seq`).
  - `enqueue(op: SyncOp)` — persists to outbox.
  - `drainOutbox()` — replays in order; each op has `opId` (idempotency), calls RPCs; on success removes; on version-mismatch/conflict flags.
  - `pullChanges(scope)` — fetch rows/cells changed since last sync (RLS-scoped), merge into cache, detect same-cell conflicts.
  - `reconcile()` — after pull, compare local cache vs server versions; produce conflict list.
  - Conflict shape: `{ rowUuid, cellKey, localValue, serverValue }`.
- Sync status hook: `useSyncStatus()` → `'online' | 'offline' | 'syncing' | 'conflit'`.

- [ ] **Step 1: Add `idb` dep** (`npm i idb`).
- [ ] **Step 2: `src/lib/db.ts` + types + outbox.**
- [ ] **Step 3: Engine push** (with idempotency `opId` columns on ops; RPC handles dedupe).
- [ ] **Step 4: Engine pull + merge + conflict detect** (pure functions → unit tests with vitest).
- [ ] **Step 5: Tests** for outbox ordering + conflict detection (pure) — run `npx vitest run`.
- [ ] **Step 6: Commit.**

### Task P4-3: Wire editor to local-first writes + online/offline

**Files:**
- Modify: `src/components/editor/cell.tsx` (write → IndexedDB + enqueue; optimistic)
- Modify: `src/lib/fiche.ts` (server read from Supabase; client cache read)
- Create: `src/lib/sync/hooks.ts` (useLocalFiche, useCellWriter)

**Interfaces:**
- Consumes: engine from P4-2.
- Produces: in the editor, every cell edit goes to IndexedDB immediately + enqueued to outbox; UI reads from local cache (seeded from Supabase on first load / after sync); sync pill shows status; cell conflicts (from pull) mark rows `conflit`.

- [ ] **Step 1: Editor reads from local cache** via `useLocalFiche`.
- [ ] **Step 2: Cell edits** go through `useCellWriter` → local + enqueue + (if online) drain.
- [ ] **Step 3: Sync status pill** in topbar reflects hook state.
- [ ] **Step 4: Test** offline editing: make edits with network off, then reconnect → outbox drains, server updated.
- [ ] **Step 5: Commit.**

### Task P4-4: Data-safety guards (beforeunload, auto-resume)

**Files:**
- Create: `src/lib/sync/guards.ts`
- Modify: `src/app/(app)/layout.tsx` (auto-resume on mount)
- Create: `src/components/sync/unsynced-banner.tsx`

**Interfaces:**
- Produces: on app load, if outbox non-empty → auto-run `drainOutbox()` + show « Reprise de la synchronisation… » until empty; `beforeunload` handler warns when outbox non-empty (native dialog); nav guard (Next `router` events or link click intercept) warns.

- [ ] **Step 1: Auto-resume on layout mount.**
- [ ] **Step 2: Beforeunload + unsynced banner.**
- [ ] **Step 3: Verify** with devtools offline + reload.
- [ ] **Step 4: Commit.**

### Task P4-5: Conflict resolution UI (teacher/admin)

**Files:**
- Create: `src/components/editor/conflict-resolver.tsx` (side-by-side A/B + choose/edit C)
- Modify: `src/components/enseignant/conflit-dialog.tsx` (real conflict data)
- Create: `src/app/(app)/fiche/[ficheId]/conflits/page.tsx` (admin view of all conflicts)

**Interfaces:**
- Consumes: conflict list from engine.
- Produces: when a row has conflict cells, the editor shows a resolver: both values side by side, choose A / B / edit to C → writes chosen value + clears conflict; logged to activity_log. Admin can open a read-only fiche with conflicts and resolve on the teacher's behalf.

- [ ] **Step 1: Resolver component** (client).
- [ ] **Step 2: Wire into editor when `conflit` cells present.**
- [ ] **Step 3: Admin conflicts page.**
- [ ] **Step 4: Typecheck/build + commit.**

---

# PHASE 5 — Print fidelity & admin oversight

### Task P5-1: Print preview routes (A4 landscape) — mockups 05 & 14

**Files:**
- Create: `src/app/(app)/impression/[ficheId]/page.tsx` — server renders print-only layout by section
- Create: `src/components/print/print-sheet.tsx` (shared A4 landscape sheet shell), `src/components/print/print-header.tsx`
- Create: `src/components/print/primary-print.tsx`, `src/components/print/secondary-print.tsx`
- Modify: `src/components/editor/print-preview-link.tsx` (link to `/impression/[ficheId]`)

**Interfaces:**
- Consumes: `getFicheForUser`; full fiche rows/cells.
- Produces: `/impression/[ficheId]` renders a paper-faithful **A4 landscape** document (2 pages for primary with page-break after Jan/Noël band; 2 pages secondary with period bands), header repeated on each page, print CSS (`@page` landscape, `break-inside: avoid`), **BROUILLON watermark** when fiche statut=brouillon, clean when soumise. Uses `@media print` to hide app chrome; the sheet reuses the document-header conventions (school block + title band + metadata row).

- [ ] **Step 1: Print layout components** matching `05`/`14` geometry (school header, title band, metadata row, grids).
- [ ] **Step 2: Page-break + @page CSS** (landscape; 2-page split; watermark only if draft).
- [ ] **Step 3: Route + wire "Aperçu impression" links** from both editors.
- [ ] **Step 4 (IMPORTANT — user inspects the PDF): produce a real, downloadable PDF file for the user to open and inspect.**

> User feedback: this step is important — the deliverable is a **PDF file I can open myself**. If the output isn't satisfactory I may ask to **increase the scale**.

Sub-steps:
- 4a. **Server-side PDF endpoint** `src/app/(app)/impression/[ficheId]/pdf/route.ts` — renders the print sheet to PDF using a headless renderer. Recommended approach in this repo (no extra server): **use a browser-level PDF via the print route + a "Télécharger le PDF" client that calls `window.print()`**, BUT to produce an actual file server-side for inspection, install `puppeteer-core` + point at the local Chrome (path from `process.env.CHROME_PATH` or the standard Windows path `C:\Program Files\Google\Chrome\Application\chrome.exe`), render `/impression/[ficheId]?format=a4&scale=1`, and return `application/pdf`.
- 4b. **Scale control**: the endpoint accepts `?scale=<float>` (default `1.0`). Map scale to print CSS `zoom`/`transform: scale()` so the user can request e.g. `?scale=1.2` if the output is too small. Store the chosen scale in the toolbar UI (« Imprimer / PDF » uses current scale; expose a small scale selector 0.8–1.5).
- 4c. **Deliver the file**: save the generated PDF to `docs/out/` (gitignored or committed as sample) as `prevision-<section>-<ficheId>.pdf` and give the user the path to open. Confirm it opens (size > 0, valid `%PDF` header).
- 4d. **Verify**: render both a draft (watermark) and submitted (clean) sample PDF; open/confirm visually; if the user reports the scale is wrong, re-render with a higher `?scale` and re-deliver.

- [ ] **Step 5: Commit.**

### Task P5-2: Admin suivi des fiches — mockup 11

**Files:**
- Create: `src/app/(app)/admin/suivi/page.tsx` (section admin; stats + tabs + filterable table)
- Create: `src/components/admin/suivi-table.tsx`, `src/components/admin/consulter-demande-dialog.tsx`

**Interfaces:**
- Consumes: list of fiches in the admin's section (RLS), unlock requests, conflict counts.
- Produces: mockup `11`: stat cards (fiches/soumises/brouillons/à traiter), tabs (Toutes/Soumissions récentes/Demandes de réouverture/Conflits), searchable/filterable table (classe, cours, sous-branche, enseignant, état, progression, soumise le, actions), « Consulter » modal on a request (read-only fiche extract + motif + Refuser/Approuver), conflicts panel.

- [ ] **Step 1: Data page** — aggregate fiches + requests for the section (super admin sees both; section admin own).
- [ ] **Step 2: Table + tabs + filters.**
- [ ] **Step 3: « Consulter » modal** (calls `getFicheForUser` read-only + approve/refuse).
- [ ] **Step 4: Typecheck/build + commit.**

### Task P5-3: Notifications centre — mockup 12

**Files:**
- Create: `supabase/migrations/0007_notifications.sql` (table `notifications`: id, user_id, type, payload, read_at, created_at) + RLS.
- Create: `src/app/(app)/notifications/page.tsx`, `src/components/notifications/notification-list.tsx`
- Modify: relevant actions to insert notifications (submit → section admins; request → admins; approve/refuse → teacher; conflict → teacher/admin)

**Interfaces:**
- Produces: notifications for: fiche soumise (→ section admins), demande de réouverture (→ section admins), demande approuvée/refusée (→ teacher), conflit détecté (→ teacher/admin), nouveau modèle (→ admins). Bell with unread count in the app shell; « Tout marquer comme lu »; unread dots.

- [ ] **Step 1: Migration 0007** + RLS.
- [ ] **Step 2: Page + list component.**
- [ ] **Step 3: Wire notification inserts into submit/unlock/conflict actions** (server-side).
- [ ] **Step 4: Typecheck/build + commit.**

### Task P5-4: Final end-to-end polish + full test pass

**Files:**
- Modify: various (small fixes surfaced by the walkthrough)
- Create: `docs/TESTING.md` (test accounts, seed data, walkthrough checklist for the full app)

**Interfaces:**
- Produces: a runnable end-to-end app; documented manual test script.

- [ ] **Step 1: Seed demo data** (a primary class + attributions + template; a secondary class + attributions + template; a teacher each).
- [ ] **Step 2: Manual E2E walkthrough** per `TESTING.md`: login as each role → super admin generates calendar → creates attribution (fiche auto-created) → teacher fills + submits → section admin approves unlock → teacher edits → resubmits → print preview shows watermark → PDF → offline edit → reconnect sync → conflict resolution.
- [ ] **Step 3: Run full checks** — `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 4: Fix surfaced issues; commit.**

---

# PHASE 6 — CSV import & data tools

> Covers the « Importer (CSV) » buttons present in the approved mockups (06 users, 07 classes, 08 branches, 09 attributions) that were intentionally deferred out of Phase 2, plus an export of fiche data for backup/audit.

### Task P6-1: CSV upload helper + shared parse/validation lib

**Files:**
- Create: `src/lib/csv.ts` (pure: parse CSV string → rows; validate row shape; produce `{ rows, errors: {line, message}[] }`)
- Create: `src/components/ui/csv-import-dialog.tsx` (shared client dialog: file picker, preview of parsed rows, per-row errors, « Importer » button that calls a server action with the parsed payload)
- Create: `src/lib/csv-templates.ts` (downloadable header templates per entity)

**Interfaces:**
- Produces:
  - `parseCsv(text: string): string[][]` (handles quoted commas, CRLF)
  - `validateUsersCsv(rows)`, `validateClassesCsv(rows)`, `validateBranchesCsv(rows)`, `validateAttributionsCsv(rows)` → typed row arrays + error list.
  - `<CsvImportDialog entity="users|classes|branches|attributions" onComplete />` — generic client that reads a `.csv`, previews, then calls the entity's import action.

- [ ] **Step 1: `src/lib/csv.ts`** parser + shared validators (pure, unit-testable).
- [ ] **Step 2: `csv-templates.ts`** header templates (nom,email,téléphone,rôle,section / section,niveau,classe,titulaire / branche,sections,sous-branches / section,classe,cours,sous-branche,enseignant).
- [ ] **Step 3: `csv-import-dialog.tsx`** shared UI.
- [ ] **Step 4: Tests** for `parseCsv` + validators (`npx vitest run`) + commit.

### Task P6-2: Wire CSV import into Users

**Files:**
- Modify: `src/app/(app)/admin/utilisateurs/actions.ts` (add `importUsersCsv`)
- Modify: `src/components/users/users-manager.tsx` (add « Importer (CSV) » → dialog)

**Interfaces:**
- Produces: `importUsersCsv(rows)` — for each valid row: create auth user (Admin API) + profile + role(s). Returns `{ created: number, errors: string[] }`. Non-idempotent-safe: if email exists, report as error row.

- [ ] **Step 1: Add `importUsersCsv` action** (uses createAdminClient; loops valid rows).
- [ ] **Step 2: Add dialog** to users-manager toolbar.
- [ ] **Step 3: Typecheck/build + commit.**

### Task P6-3: Wire CSV import into Classes

**Files:**
- Modify: `src/app/(app)/[section]/structure/actions.ts` (add `importClassesCsv`)
- Modify: `src/components/structure/structure-manager.tsx` (add « Importer (CSV) »)

**Interfaces:**
- Produces: `importClassesCsv(section, yearId, rows)` — creates classes (level, name, ordre, titulaire by email→profile lookup). Returns `{ created, errors }`.

- [ ] **Step 1: Add action** (look up titulaire by email from profiles; skip/error unknown).
- [ ] **Step 2: Add dialog.**
- [ ] **Step 3: Typecheck/build + commit.**

### Task P6-4: Wire CSV import into Branches

**Files:**
- Modify: `src/app/(app)/admin/branches/actions.ts` (add `importBranchesCsv`)
- Modify: `src/components/branches/branches-manager.tsx`

**Interfaces:**
- Produces: `importBranchesCsv(rows)` — row: branche, sections (comma list), sous-branches (comma list). Creates branch + sous-branches. Returns `{ created, errors }`.

- [ ] **Step 1: Add action.**
- [ ] **Step 2: Add dialog.**
- [ ] **Step 3: Typecheck/build + commit.**

### Task P6-5: Wire CSV import into Attributions

**Files:**
- Modify: `src/app/(app)/[section]/attributions/actions.ts` (add `importAttributionsCsv`)
- Modify: `src/components/attributions/attributions-manager.tsx`

**Interfaces:**
- Produces: `importAttributionsCsv(section, yearId, rows)` — resolves classe name, branche name, sous-branche name, enseignant email → creates attribution (which auto-creates the draft fiche via the existing `createAttribution` logic). Returns `{ created, errors }`.

- [ ] **Step 1: Refactor the attribution-creation body** in actions into a helper reused by both `createAttribution` and `importAttributionsCsv`.
- [ ] **Step 2: Add action + dialog.**
- [ ] **Step 3: Typecheck/build + commit.**

### Task P6-6: Fiche data export (backup/audit)

**Files:**
- Create: `src/app/(app)/admin/export/route.ts` (or server action) — exports fiches (or all fiches of a section/year) to CSV/JSON.
- Create: `src/components/admin/export-button.tsx`

**Interfaces:**
- Produces: `GET /admin/export?yearId=&section=` returns a downloadable CSV of all fiches (classe, cours, sous-branche, enseignant, statut, rows → cells flattened) respecting RLS (super admin all, section admin own section).

- [ ] **Step 1: Route handler** generating CSV from RLS-scoped query.
- [ ] **Step 2: Export button** on the admin suivi page (P5-2) + dashboard.
- [ ] **Step 3: Typecheck/build + commit.**

---

# PHASE 7 — Deployment & release

> **STATUS: ON HOLD — do not start until the user gives the go.**
> User decision: Phase 7 waits until everything is nicely sorted locally (Phases 3–6 built, tested, and reviewed). The user will explicitly green-light deployment later. Do not create the Vercel project, prod Supabase project, CI, or deploy before that go-ahead.

### Task P7-1: Vercel project + environment config

**Files:**
- Create/Modify: `vercel.json`, `.env.production.example`, README deployment notes
- Modify: `src/lib/supabase/*` — confirm env selection by `VERCEL_ENV` (matching the user's wedding-app convention).

**Interfaces:**
- Produces: a Vercel project (`previsions-mat`) linked to the repo; production env vars set (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); `vercel.json` build config (if needed).

- [ ] **Step 1: Create Vercel project** via `vercel` CLI (or dashboard) linked to `ngJohn120/previsions_mat`.
- [ ] **Step 2: Set env vars** in Vercel (production + preview) — from `.env.local`-equivalent values, never committed.
- [ ] **Step 3: Add README deploy notes** (env selection by `VERCEL_ENV` per user's convention).
- [ ] **Step 4: Commit config + docs.**

### Task P7-2: Production Supabase project + migrations

**Files:**
- Create: `supabase/.env.prod` (project ref only; keys via Vercel/dashboard)
- Modify: migration ordering check.

**Interfaces:**
- Produces: a **separate production Supabase project** (do NOT reuse the dev `xwetugbbfscbkzhiqcfr` for live data unless the user confirms), migrations `0001`–`0007` applied via `supabase db push --project-ref <prod-ref>`, RLS on.

- [ ] **Step 1: Confirm with user** whether to reuse the current project or create a dedicated prod project (recommend separate).
- [ ] **Step 2: Link + push migrations** to prod.
- [ ] **Step 3: Seed the super-admin account** via Admin API (or invite) in prod.
- [ ] **Step 4: Verify** RLS + sign-in on prod project.

### Task P7-3: CI (optional but recommended) — migrations on push

**Files:**
- Create: `.github/workflows/migrations.yml`

**Interfaces:**
- Produces: on push to `main`, run `supabase db push` to the prod project (requires `SUPABASE_ACCESS_TOKEN` + `PROD_PROJECT_REF` secrets). Mirrors the user's wedding-app "auto-migrations on main push" convention.

- [ ] **Step 1: Write workflow** using supabase/setup-cli + `supabase db push`.
- [ ] **Step 2: Add secrets** (user provides access token + prod ref).
- [ ] **Step 3: Verify** a push triggers a green run.

### Task P7-4: Deploy + smoke test

**Files:**
- Modify: any env/config surfaced by deploy.

**Interfaces:**
- Produces: a live app at `https://previsions-mat.vercel.app` (or user-chosen name); login + one role flow smoke-tested against prod DB.

- [ ] **Step 1: Deploy** (`vercel --prod` or via git push).
- [ ] **Step 2: Smoke test** — load `/login`, sign in as super admin (prod), confirm home renders.
- [ ] **Step 3: Fix any prod-only issues; commit.**
- [ ] **Step 4: Report live URL + test accounts to the user.**

---

## Self-Review Notes

- **Spec coverage:** P3 covers §6 editors (02/03/04) + submit/unlock lifecycle + consultation; P4 covers §5 offline sync/data-safety/conflicts; P5 covers print (§6 05/14) + oversight (§6 11/12) + real PDF deliverable with scale control (user feedback). P6 covers the deferred CSV import buttons (mockups 06–09) + export. P7 covers Vercel + prod Supabase deploy (+ optional CI). Structure/admin screens (06–10, 13) were Phase 2 (done).
- **Placeholder scan:** no TBD. Items marked "stub until P4" in P3 (conflict dialog) are explicitly wired in P4-5; the demo/test seeding is concrete. P7-2 Step 1 flags a user decision (separate prod project vs reuse) as a gate, not a placeholder. **Phase 7 is explicitly ON HOLD by user decision** — see the status note at the top of the phase; local phases (3–6) proceed first.
- **Type consistency:** `set_cell_value(p_cell_id, p_value, p_expected_version)` is used by P3-3/4 (online) and reused by P4-2 (outbox); `row_uuid`/`fiche_rows`/`fiche_cells` names match Phases 1–2. CSV validators share the pure `parseCsv`; import actions reuse existing create helpers (e.g. attribution creation refactored in P6-5). Notifications table naming is introduced in P5-3 only.
- **Filename note:** this file is named `phases3-5-...` for continuity but now covers Phases 3–7.
