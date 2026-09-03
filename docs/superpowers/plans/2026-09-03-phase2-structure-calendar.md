# Phase 2 — Academic Structure & Calendar/Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the academic-structure management (school years, classes, branches & sous-branches, attributions, users, rollover) AND the calendar/template engine (month-grid builder, weekly-row generation, template versioning) that feeds draft fiches — matching the approved mockups `06`–`10` and `13`.

**Architecture:** Server-rendered Next.js routes (App Router) backed by Supabase RPCs/queries. Super admin manages structure + calendar; section admins manage their section's classes/branches/attributions within the active year. Calendar builder generates ordered weekly rows (stable row UUIDs) stored as a template version per year+section; attributions create draft fiches from the active template. Template changes after drafts exist create a new version applied only to selected drafts.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, shadcn/ui (table/dialog/select/input/button/badge/calendar), @supabase/supabase-js, date-fns.

**Spec:** `docs/superpowers/specs/2026-09-02-previsions-matieres-design.md`
**Depends on:** Phase 1 (scaffold, auth/roles, RLS, schema baseline: `profiles`, `user_roles`, `school_years`, `sections`, `classes`, `branches`, `sous_branches`, `attributions`, `fiches`, `fiche_rows`, `fiche_cells`, `template_versions`, `unlock_requests`, `activity_log`).

## Global Constraints

- French-only UI; code/docs English. Terminology binding: fiche, cours, branche, sous-branche, attribution, sections Primaire/Secondaire.
- Approvers: Primary → « le Directeur »; Secondary → « le Préfet / D.E. ».
- Work on `main`; **no auto-commits** — user approves each commit.
- Dev on port 3001 (not 3000). LAN via `LOCAL_LAN_HOST`.
- Mockups in `docs/mockups/` are binding: `06-gestion-utilisateurs`, `07-structure`, `08-matieres-sous-branches`, `09-affectations`, `10-calendrier` (grille mensuelle, concept C), `13-rollover` (5-step wizard).
- Calendar builder = **grille mensuelle (concept C)**: month-by-month grid; teaching weeks appear as badges on Monday-start cells; event types colored; click a day/side panel to edit; per-section toggle.
- Row/template rule: rows carry stable UUIDs; a template edit once drafts exist creates a **new version** and is applied **manually to selected drafts**; submitted fiches never auto-update.

---

### Task 1: School-year context provider + switcher

**Files:**
- Create: `src/lib/school-year.ts`
- Create: `src/components/school-year-switcher.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `getActiveSchoolYear()` → `SchoolYear | null` (active row); `listSchoolYears()`; `<SchoolYearSwitcher currentYearId onSwitch>` (topbar chip « Année 2026 – 2027 »).
- Consumes: `school_years` table (Phase 1), `createServerClient()`.

- [ ] **Step 1: Write `getActiveSchoolYear()` / `listSchoolYears()`** server helpers (status='active' first, then upcoming/archived).
- [ ] **Step 2: Build the switcher** — dropdown of years; switching calls a server action to set a `year` cookie.
- [ ] **Step 3: Wire into `(app)/layout.tsx`** — fetch active year and pass to topbar; render switcher chip.
- [ ] **Step 4: Verify** — dev on 3001; topbar shows active year.
- [ ] **Step 5: Commit (with user approval)**.

---

### Task 2: Users management (super admin) — `06-gestion-utilisateurs.html`

**Files:**
- Create: `src/app/(app)/admin/utilisateurs/page.tsx`
- Create: `src/app/(app)/admin/utilisateurs/actions.ts`
- Create: `src/components/users/users-table.tsx`, `src/components/users/users-form-dialog.tsx`

**Interfaces:**
- Consumes: `profiles`, `user_roles`, Supabase Auth admin (service role).
- Produces: server actions `createUser`, `updateUser`, `resetPassword`, `toggleActive`, `importUsersCsv`.
- Data shape: `{ id, full_name, email, phone, roles: [{role, section}], disabled }`.

- [ ] **Step 1: `createUser`** — `supabase.auth.admin.createUser({email,password,email_confirm:true})`; insert `profiles` (full_name, phone); insert `user_roles` rows (role + section).
- [ ] **Step 2: `updateUser`** — update profile fields + replace roles.
- [ ] **Step 3: `resetPassword`** — `auth.admin.updateUserById(id,{password: temp})`; return temp once for display.
- [ ] **Step 4: `toggleActive`** — flip `profiles.disabled` (middleware blocks sign-in when disabled).
- [ ] **Step 5: `importUsersCsv`** — parse (nom, email, téléphone, rôle, section); per-row create; return summary {created, errors[]}.
- [ ] **Step 6: Build page** matching mockup 06: stat cards (total, enseignants, administrateurs, actifs), search + role/section filters, table with role pills, active switch, « Nouvel utilisateur » dialog, « Réinit. mdp ».
- [ ] **Step 7: Verify** (create a teacher, sign in as them) + **Commit (with user approval)**.

---

### Task 3: Structure scolaire — `07-structure.html`

**Files:**
- Create: `src/app/(app)/[section]/structure/page.tsx` (section = primaire|secondaire)
- Create: `src/app/(app)/[section]/structure/actions.ts`
- Create: `src/components/structure/class-card.tsx`, `src/components/structure/classes-form-dialog.tsx`

**Interfaces:**
- Consumes: `sections`, `classes`, `profiles` (titulaires).
- Produces: server actions `createClass`, `updateClass`, `setTitulaire`, `deleteClass` (only when no fiches? — no: fiches depend on attributions, classes deletable if no attributions), `importClassesCsv`.
- Data shape: `{ id, school_year_id, section, name, level, order, titulaire_id }`.

- [ ] **Step 1: Server actions** CRUD classes + set titulaire.
- [ ] **Step 2: Class-card grid** per mockup 07 (segmented Primaire/Secondaire, cards: level chip, name, titulaire, « Cours : N »), add/edit dialog + CSV.
- [ ] **Step 3: Titulaire select** lists teachers (role=enseignant) in the section.
- [ ] **Step 4: Verify + Commit (with user approval)**.

---

### Task 4: Branches & sous-branches — `08-matieres-sous-branches.html`

**Files:**
- Create: `src/app/(app)/admin/branches/page.tsx`
- Create: `src/app/(app)/admin/branches/actions.ts`
- Create: `src/components/branches/branches-table.tsx`, `src/components/branches/branches-form-dialog.tsx`

**Interfaces:**
- Consumes: `branches`, `sous_branches`.
- Produces: server actions `createBranche`, `updateBranche`, `deleteBranche`, `addSousBranche`, `removeSousBranche`, `importBranchesCsv`.
- Data shape: `{ id, name, sections: ('primaire'|'secondaire')[], sous_branches: [{id,name}] }`.

- [ ] **Step 1: Server actions** (branch name + sections; sous-branches nested CRUD).
- [ ] **Step 2: Branches table** with filters (recherche, section, avec/sans sous-branches) + chips + actions.
- [ ] **Step 3: Branches form dialog** per mockup 08: name, « Utilisable en » checkboxes, dynamic sous-branche list (add/remove), validation note for in-use sous-branches.
- [ ] **Step 4: CSV import**.
- [ ] **Step 5: Verify + Commit (with user approval)**.

---

### Task 5: Calendar & template schema + generator service

**Files:**
- Create: `src/lib/calendar.ts` (pure functions)
- Modify: `supabase/migrations/000X_calendar.sql` (template rows)
- Create: `src/lib/templates.ts` (version read/write, applyToDraft)

**Interfaces:**
- Produces (pure):
  - `buildWeeks({ startDate, endDate, exclude?: Date[] })` → `{ semaine_num, start, end, mois }[]` (Monday-start weeks, sequential numbering).
  - `generateRowsForSection({ yearId, section, periods })` → `FicheRowSeed[]` (row_type, ordre, mois, semaine_num, date_label, periode_label, evenement_label|null).
  - `templateVersionFor({ yearId, section, isActive=true })`.
  - `createNewTemplateVersion({ yearId, section, rows, previousVersion })`.
  - `applyTemplateVersionToFiches({ templateVersionId, ficheIds[] })` — matches by `row_uuid`; preserves cell content where row_uuid matches; adds new rows empty; flags removed rows.
- Consumes: schema tables (`template_versions`, plus a `template_rows` table — see step 1).

- [ ] **Step 1: Schema migration** — add `template_rows` (id uuid PK, template_version_id uuid FK, row_uuid uuid, ordre int, row_type, mois, semaine_num, date_label, periode_label, evenement_label) and a `version` bump on `template_versions`.
- [ ] **Step 2: Implement `buildWeeks`** (Monday weeks; month label from start date; week belongs to its start month — per spec).
- [ ] **Step 3: Implement `generateRowsForSection`** — given official period date ranges + event markers, produce ordered rows incl. event band rows.
- [ ] **Step 4: Implement `templateVersionFor` / `createNewTemplateVersion` / `applyTemplateVersionToFiches`** with row_uuid matching.
- [ ] **Step 5: Unit tests** for `buildWeeks` + `applyTemplateVersionToFiches` (vitest) — commit tests + code (with user approval).

---

### Task 6: Calendar builder UI (month-grid, concept C) — `10-calendrier.html`

**Files:**
- Create: `src/app/(app)/admin/calendrier/page.tsx`
- Create: `src/app/(app)/admin/calendrier/actions.ts`
- Create: `src/components/calendar/month-grid.tsx`, `src/components/calendar/week-side-panel.tsx`, `src/components/calendar/generate-dialog.tsx`

**Interfaces:**
- Consumes: `template_rows` (for the active version of the chosen year+section), `generateRowsForSection`, `createNewTemplateVersion`, `applyTemplateVersionToFiches`.
- Produces: month-grid calendar per mockup `10` (concept C): month nav, teaching-week badges S1…Sn on Monday-start cells, event badges colored by type; right « Semaine sélectionnée » panel (N°, dates, période, type; Modifier / Marquer comme événement); « Générer le calendrier » dialog (rentrée, fin, période split); Prim/Second toggle; info banner about versioning when drafts exist.

- [ ] **Step 1: Page data load** — active year + section rows for current month; provide `listRowsForMonth(yearId, section, month)`.
- [ ] **Step 2: Build `month-grid.tsx`** — render grid (Lun–Dim), place week badges on correct cells; color by row_type (enseignement blue, évaluation purple, examen red, révision amber, vacances gold).
- [ ] **Step 3: Side panel + click-to-select** — clicking a day opens « Semaine sélectionnée » with week details; Modifier opens dialog (dates/période/type); « Marquer comme événement » sets row_type.
- [ ] **Step 4: Generate dialog** — invokes generator; if drafts exist for the section, prompt to create **new version** + show impact (how many draft fiches) before applying.
- [ ] **Step 5: Versioning flow** — when editing rows after drafts exist: create vN+1, show « Voir l'impact » (count of drafts), let admin choose target draft fiches; submit applies via `applyTemplateVersionToFiches`.
- [ ] **Step 6: Verify** (Sept 2026 month shows S1–S5; event weeks colored; version banner shows) + **Commit (with user approval)**.

---

### Task 7: Attributions — `09-affectations.html` (fiche generation wired to templates)

**Files:**
- Create: `src/app/(app)/[section]/attributions/page.tsx`
- Create: `src/app/(app)/[section]/attributions/actions.ts`
- Create: `src/components/attributions/attributions-table.tsx`, `attribution-form-dialog.tsx`

**Interfaces:**
- Consumes: `attributions`, `classes`, `branches`, `sous_branches`, `profiles`, `templateVersionFor`, `generateRowsForSection`.
- Produces: server actions `createAttribution` (creates attribution + **draft fiche from active template rows**), `updateAttribution`, `deleteAttribution` (only if fiche brouillon, else blocked), `importAttributionsCsv`.
- Fiche creation: on attribution insert, if active template version exists → create `fiches` (brouillon) + `fiche_rows` copies (row_uuid preserved) + empty `fiche_cells`.

- [ ] **Step 1: `createAttribution`** — insert; if active template exists, create fiche + rows + empty cells in one RPC/transaction.
- [ ] **Step 2: `updateAttribution`** — update fields; warn if fiche already submitted (only allow metadata change when no fiche soumise).
- [ ] **Step 3: Attributions table** per mockup 09 (classe, cours, sous-branche, enseignant, fiche état chip, actions) + segmented Prim/Second.
- [ ] **Step 4: Attribution dialog** (section, classe, cours, sous-branche optionnel, enseignant).
- [ ] **Step 5: CSV import**.
- [ ] **Step 6: Verify** — creating an attribution in a year with an active template produces a draft fiche with the generated rows. **Commit (with user approval)**.

---

### Task 8: Rollover (new school year) — `13-rollover.html`

**Files:**
- Create: `src/app/(app)/admin/annee/page.tsx`
- Create: `src/app/(app)/admin/annee/actions.ts`
- Create: `src/components/rollover/rollover-wizard.tsx` (5-step)
- Create: `src/components/rollover/*` (per-step panels)

**Interfaces:**
- Consumes: `school_years`, structure tables, `template_versions`/`template_rows`, `profiles`.
- Produces: server actions `createSchoolYear` (with clone options), `cloneStructure(fromYearId,toYearId)`, `validateSectionForYear(yearId, section)`, `setYearStatus`, `archiveYear`.
- 5 steps: 1 Paramètres → 2 Structure (cloned rows + per-row change) → 3 Révision sections (per-admin validation cards) → 4 Calendriers (clone/generate per section, link to calendar builder) → 5 Activation (gated on section validation, archive previous, notify teachers — notification stub).

- [ ] **Step 1: Server actions** (`createSchoolYear`, `cloneStructure`, `validateSectionForYear`, `setYearStatus`, `archiveYear`).
- [ ] **Step 2: Step 1** — libellé + dates + clone checkboxes.
- [ ] **Step 3: Step 2** — cloned classes/attributions table (per-row Changer → calls attribution dialog).
- [ ] **Step 4: Step 3** — section-admin validation cards (state per section).
- [ ] **Step 5: Step 4** — clone/generate calendar per section (invoke `createNewTemplateVersion` or link to calendar builder).
- [ ] **Step 6: Step 5** — activation gated on both sections validated; archive previous year; notify teachers (toast/stub; real notification Phase 7).
- [ ] **Step 7: Verify** — end-to-end rollover creates new year with cloned structure + generated calendar; old year archived. **Commit (with user approval)**.

---

## Self-Review Notes

- **Spec coverage:** structure mgmt (06–09), calendar builder (10), rollover (13) all present. Fiche editor + submit/unlock (04/05/11) remain in a later phase, but draft-fiche creation and template versioning are fully covered here.
- **Placeholder scan:** no TBD. Rollover step 5's teacher notification is an explicit stub pointing to the later notifications phase.
- **Type consistency:** `row_uuid`, `template_rows`, `attributions`, `fiches` etc. follow the Phase 1 schema; functions named consistently across Tasks 5–8.
