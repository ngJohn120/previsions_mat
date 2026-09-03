# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js + Supabase project for Prévisions Matières with authentication, role-based authorization (super admin / section admin / teacher), and the core database schema.

**Architecture:** A Next.js (App Router) app served on Vercel, backed by Supabase (email/password auth + PostgreSQL + RLS). Database migrations define the full relational schema; RLS enforces section/role scoping; a roles helper provides the authorization model. All UI copy is French; code/docs in English.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, @supabase/supabase-js, @supabase/ssr, Supabase CLI for migrations.

**Spec:** `docs/superpowers/specs/2026-09-02-previsions-matieres-design.md`

## Global Constraints

- Repository: `ngJohn120/previsions_mat` (local: `C:\Users\Administrator\Documents\MEGA\Documents\SILOE\Prevision_WebApp`).
- Work on `main`; **no auto-commits** — the user approves each commit.
- French-only UI strings and generated documents. Code/docs in English.
- Dev on port **3001** (port 3000 is the Hermes WhatsApp bridge); LAN via `LOCAL_LAN_HOST`.
- Terminology (binding): fiche (annual plan), cours (subject as taught/assigned), branche (catalogue subject), sous-branche (optional sub, mainly primary), attribution (class + cours + teacher), sections Primaire/Secondaire.
- Approvers: Primary → « le Directeur »; Secondary → « le Préfet / D.E. ».
- Never copy `.env.local` keys to production. Env selected by `VERCEL_ENV`.
- UI ground rule: approved mockups in `docs/mockups/` are binding.
- Node 20+, `npm` (per user's existing projects), TypeScript strict.

---

### Task 1: Scaffold the Next.js app + shadcn/ui

**Files:**
- Create: project root scaffold (in place, current folder is the repo root)
- Create: `src/app/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx`, `tailwind.config.*`, `components.json`, `package.json`

**Interfaces:**
- Produces: a runnable Next.js 14 App Router app with Tailwind + shadcn/ui base, French locale placeholder, empty landing page.

- [ ] **Step 1: Scaffold Next.js in the current repo**

The project folder is already a git repo (origin `ngJohn120/previsions_mat`). Because the repo root already contains docs/ and the mockups, scaffold the app **into the current directory** using create-next-app with the flags to allow non-empty dir (or scaffold into a temp subdir and move files up):

```bash
cd "C:\Users\Administrator\Documents\MEGA\Documents\SILOE\Prevision_WebApp"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

If create-next-app refuses because of existing files, scaffold into `_scaffold/` and move contents up:

```bash
npx create-next-app@latest _scaffold --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
# move everything except docs/, mockups/, .git, design files up one level, then remove _scaffold
```

- [ ] **Step 2: Install shadcn/ui and initialize**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label select table badge dialog
```

- [ ] **Step 3: Set the app metadata & French lang**

In `src/app/layout.tsx` set `lang="fr"` and metadata title `Prévisions Matières — Complexe Scolaire SILOE`.

- [ ] **Step 4: Start dev server and verify**

```bash
npm run dev -- -p 3001
```

Expected: `http://localhost:3001` serves the scaffold landing page. Verify with curl/HTTP 200.

- [ ] **Step 5: Commit (with user approval)**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind + shadcn/ui"
```

---

### Task 2: Supabase project + migrations setup

**Files:**
- Create: `supabase/config.toml`, `supabase/.env`, `supabase/migrations/0001_init.sql` (schema baseline), `supabase/seed.sql`

**Interfaces:**
- Produces: a Supabase project linked locally with the CLI, migration baseline applied, and seed scripts for roles/data.

- [ ] **Step 1: Link/create the Supabase project**

```bash
npx supabase init
npx supabase link --project-ref <PROJECT_REF>   # or create via dashboard
```

Use a dedicated project (e.g. `previsions-mat`). Record the project ref.

- [ ] **Step 2: Create the baseline migration**

Write `supabase/migrations/0001_init.sql` with the schema (see Task 3 for tables) and RLS policies (Task 4). Apply:

```bash
npx supabase db push
```

- [ ] **Step 3: Create seed data**

Write `supabase/seed.sql` with sections (`Primaire`, `Secondaire`), a test school year (2026-2027), and test accounts (see Task 5). Apply via the dashboard SQL editor or `supabase db reset`.

- [ ] **Step 4: Verify schema**

Expected: tables exist, RLS enabled, seed rows present. Use the Supabase dashboard or `supabase db dump`.

- [ ] **Step 5: Commit (with user approval)**

```bash
git add supabase/
git commit -m "feat: add Supabase project + baseline migration"
```

---

### Task 3: Core schema (school years, sections, classes, branches, attributions, fiches)

**Files:**
- Create: `supabase/migrations/0001_init.sql` (this task's table definitions; Task 2 references it — order: write this schema before applying in Task 2, or make it part of 0001)

**Interfaces:**
- Produces (Postgres tables):
  - `profiles` (id uuid PK ref auth.users, full_name text, phone text nullable, created_at)
  - `user_roles` (user_id uuid ref auth.users, role text check in ('super_admin','admin_primaire','admin_secondaire','enseignant'), section text nullable check in ('primaire','secondaire'), unique(user_id, role, section?))
  - `school_years` (id uuid PK, label text, start_date date, end_date date, status text check in ('upcoming','active','archived'))
  - `sections` (id text PK check in ('primaire','secondaire'), name text)
  - `classes` (id uuid PK, school_year_id uuid ref school_years, section text ref sections, name text, order int, titulaire_id uuid nullable ref profiles)
  - `branches` (id uuid PK, name text, sections text[] check ('primaire'/'secondaire'), — shared catalogue)
  - `sous_branches` (id uuid PK, branche_id uuid ref branches, name text)
  - `attributions` (id uuid PK, school_year_id, classe_id, branche_id, sous_branche_id nullable, enseignant_id uuid ref profiles, unique per year/classe/branche/sous-branche)
  - `fiches` (id uuid PK, attribution_id uuid ref attributions, school_year_id, statut text check in ('brouillon','soumise'), version int default 1, created_at, submitted_at nullable, fiche_uuid stable uuid)
  - `fiche_rows` (id uuid PK, fiche_id uuid ref fiches, row_uuid uuid, ordre int, row_type text check in ('enseignement','evenement'), mois text nullable, semaine_num int nullable, date_label text nullable, periode_label text nullable)
  - `fiche_cells` (id uuid PK, fiche_row_id uuid ref fiche_rows, col_key text, value text, version int default 1, updated_by uuid, updated_at)
  - `unlock_requests` (id uuid PK, fiche_id uuid ref fiches, demandeur_id uuid, motif text, statut text check in ('en_attente','approuvee','refusee'), traite_par uuid nullable, traite_le timestamptz nullable)
  - `activity_log` (id bigint PK, fiche_id uuid nullable, actor_id uuid, action text, details jsonb, created_at)
  - `template_versions` (id uuid PK, school_year_id, section text, version int, is_active bool, config jsonb)

  Add an `updated_at` trigger helper and `moddatetime`.

- [ ] **Step 1: Write the migration**

Provide full SQL for the above tables, with `auth.uid()` defaults, FK ON DELETE CASCADE where sensible, and the `updated_at` trigger function.

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: no errors, all tables listed in dashboard.

- [ ] **Step 3: Verify with a query**

```sql
select table_name from information_schema.tables where table_schema='public' order by table_name;
```

Expected: all core tables present.

- [ ] **Step 4: Commit (with user approval)**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: core schema (years, sections, classes, branches, attributions, fiches)"
```

---

### Task 4: RLS policies + authorization helper

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append RLS + policies)
- Create: `supabase/migrations/0002_rls_policies.sql` (if cleaner to separate)

**Interfaces:**
- Produces: row-level security that scopes:
  - teachers to their own attributions/fiches (via `auth.uid() = attributions.enseignant_id` or join)
  - section admins to their section's data
  - super admin to everything
- Produces a Postgres function `app.current_role()` / `app.is_super_admin()` helper used by policies.

- [ ] **Step 1: Write helper functions**

```sql
create or replace function app.is_super_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'super_admin');
$$;
-- similarly is_section_admin('primaire'), is_teacher_of(fiche_id), section_of_class(...)
```

- [ ] **Step 2: Enable RLS on all tables**

```sql
alter table public.profiles enable row level security;
-- ... (all tables)
```

- [ ] **Step 3: Write policies**

- `profiles`: select/insert/update by super_admin OR own row.
- `classes`, `attributions`, `fiches`, etc.: select if super_admin OR section admin of matching section OR (teacher: own attributions).
- `activity_log`: select by super_admin / section admin.
- All writes restricted appropriately (teachers only mutate their own draft fiches' rows/cells; submit via RPC).

- [ ] **Step 4: Apply + verify**

```bash
npx supabase db push
```

Then verify RLS is on via dashboard (`RLS enabled` per table).

- [ ] **Step 5: Commit (with user approval)**

```bash
git add supabase/
git commit -m "feat: RLS policies + role helpers"
```

---

### Task 5: Auth pages (login) + profile/session handling with @supabase/ssr

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`
- Create: `src/middleware.ts`
- Create: `src/app/(auth)/login/page.tsx` — French login (mockup `01-login.html`)
- Create: `src/app/(auth)/login/actions.ts`
- Modify: `src/app/layout.tsx` to include Supabase provider

**Interfaces:**
- Produces: `createClient()` (browser), `createServerClient()` (server), `updateSession()` middleware; `/login` route; sign-out.
- Consumes: Supabase env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (from `.env.local`).

- [ ] **Step 1: Add env vars + deps**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

Add `.env.local` with the anon key/URL (from Supabase dashboard). Never commit.

- [ ] **Step 2: Implement the supabase clients + middleware** (following @supabase/ssr docs pattern with cookie handling).

- [ ] **Step 3: Build the login page (French)**

Match `01-login.html`: brand header, email + password fields, "Mot de passe oublié ?" link, "Se connecter", offline sync-resume banner placeholder (real logic later). Server action calls `supabase.auth.signInWithPassword`.

- [ ] **Step 4: Route protection**

Middleware redirects unauthenticated users to `/login`; role-based nav appears once roles are used (Task 6/7).

- [ ] **Step 5: Verify**

Start dev on 3001. Create a test user (seed). Sign in → redirect to a protected placeholder dashboard. Sign out works.

- [ ] **Step 6: Commit (with user approval)**

```bash
git add src/
git commit -m "feat: Supabase auth (login) with SSR session handling"
```

---

### Task 6: Roles → profile fetch + a basic role-aware home

**Files:**
- Create: `src/lib/auth.ts` (getCurrentUser, getRoles, isSuperAdmin, sectionAdminOf, teacher helper)
- Create: `src/app/(app)/layout.tsx` — authenticated shell (sidebar/topbar per mockups, year/section chips, sync pill placeholder)
- Create: `src/app/(app)/page.tsx` — placeholder home (role-based)

**Interfaces:**
- Consumes: `user_roles` table.
- Produces: `getRoles(userId)` returning array of roles; role-based redirect/home.

- [ ] **Step 1: Implement auth helper**

Read profile + roles; expose `role` and `section`.

- [ ] **Step 2: Implement the app shell**

Build the sidebar (per super-admin mockups 06–10 style but generic) with role-aware nav; topbar with year chip + section chip + sync pill (static for now).

- [ ] **Step 3: Role-aware home**

Super admin → "Toutes les fiches"; section admin → "Suivi des fiches"; teacher → "Mes fiches". For now each is a stub.

- [ ] **Step 4: Verify** — log in as each role and confirm the home/nav differ.

- [ ] **Step 5: Commit (with user approval)**

---

### Task 7: Test accounts seed

**Files:**
- Modify: `supabase/seed.sql`

**Interfaces:**
- Produces: demo accounts (Super admin `direction@siloe.edu`, Admin primaire, Admin secondaire, Enseignants) with known passwords, for local/dev + documented in docs (FR section « Comptes de test »).

- [ ] **Step 1: Write seed users** via `supabase.auth.admin.createUser` or SQL insert into auth.users (service-role approach). Provide stable emails/passwords.

- [ ] **Step 2: Add profiles + user_roles** rows matching.

- [ ] **Step 3: Apply seed** (`supabase db reset --seed` or dashboard SQL).

- [ ] **Step 4: Verify** each role can sign in and sees the right scoped home.

- [ ] **Step 5: Commit (with user approval)**

---

## Self-Review Notes

- **Spec coverage (Phase 1 only):** scaffold/auth/RLS/seed. Later phases (structure mgmt, calendar engine, editors, offline sync, print, rollover) are split into their own plan docs per the scope check.
- **Placeholder scan:** no TBD/TODO — where logic is deferred (e.g. real sync) it is explicitly marked as a later phase, not left as a stub within this plan.
- **Type consistency:** table names/columns above match across Tasks 2–7; RLS helpers named consistently.
