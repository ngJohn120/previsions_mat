# Per-Year Teacher Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teachers gain per-year roster membership (`teacher_years`); departed teachers surface as orphans in Révision and block validation/activation until reassigned.

**Architecture:** One new table + RLS (mirroring `0012_year_section_validations.sql`); one new `src/lib/roster.ts` helper module consumed by year-creation, user-creation, assignment pages/actions, and Révision; no changes to existing tables.

**Tech Stack:** Next.js server actions, Supabase Postgres + RLS, TypeScript, vitest (`npm test`), `npx tsc --noEmit`, `npx eslint <files>`, psql via `podman exec supabase_db_Prevision_WebApp psql -U postgres -d postgres`.

## Global Constraints

- Dev server runs on port 3001; port 3000 belongs to the Hermes bridge — never use it.
- French only for UI strings; docs/discussion in English.
- No commits until the whole feature is implemented AND the user approves (per-task "commit" steps are replaced by checkpoint reviews).
- `ENABLE ROW LEVEL SECURITY` must appear in the migration (lesson from 0012: policies without it are inert).
- No `any` in new code (`@typescript-eslint/no-explicit-any` is an error).
- Temp browser verify scripts go in `scripts/` and are deleted after verification.
- Never read/print/commit secrets; `.env*` files are off-limits.

---

### Task 1: Migration `0013_teacher_years.sql`

**Files:**
- Create: `supabase/migrations/0013_teacher_years.sql`
- Test: direct psql simulation (no repo test file — RLS is verified live, same as 0012)

**Interfaces:**
- Produces: table `public.teacher_years(user_id uuid, school_year_id uuid, section text, is_active boolean, created_at, updated_at)` PK `(user_id, school_year_id, section)`; RLS policies `teacher_years_select/insert/update` (no delete policy); backfill rows.

- [ ] **Step 1: Write the migration**

```sql
-- 0013: per-year teacher roster. Who teaches in which year+section.
-- Roster membership only — login rights and roles stay global (user_roles).
create table public.teacher_years (
  user_id uuid not null references auth.users(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete cascade,
  section text not null check (section in ('primaire', 'secondaire')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, school_year_id, section)
);
create index idx_teacher_years_year on public.teacher_years(school_year_id);

create trigger trg_teacher_years_updated_at
  before update on public.teacher_years
  for each row execute function public.handle_updated_at();

-- Without this line the policies below are inert (0012 lesson).
alter table public.teacher_years enable row level security;

create policy "teacher_years_select"
  on public.teacher_years for select to authenticated
  using (public.is_super_admin() or public.is_section_admin(section));

create policy "teacher_years_insert"
  on public.teacher_years for insert to authenticated
  with check (public.is_super_admin() or public.is_section_admin(section));

create policy "teacher_years_update"
  on public.teacher_years for update to authenticated
  using (public.is_super_admin() or public.is_section_admin(section))
  with check (public.is_super_admin() or public.is_section_admin(section));

-- Backfill: every current enseignant role row × every existing year, active.
insert into public.teacher_years (user_id, school_year_id, section, is_active)
select r.user_id, y.id, r.section, true
from public.user_roles r
join public.school_years y on true
where r.role = 'enseignant' and r.section in ('primaire', 'secondaire')
on conflict do nothing;
```

Apply to the local DB (migrations run via the project's Supabase setup; verify rows exist):

Run: `podman exec supabase_db_Prevision_WebApp psql -U postgres -d postgres -c "select count(*) from public.teacher_years;"`
Expected: count = (# enseignant role rows with a section) × (# years), all `is_active = true`.

- [ ] **Step 2: Verify RLS the 0012 way — cross-section access must fail**

```bash
podman exec supabase_db_Prevision_WebApp psql -U postgres -d postgres -c "
begin;
set local role authenticated;
set local request.jwt.claims to '{\"sub\": \"<admin.prim-uuid>\", \"role\": \"authenticated\"}';
-- admin.prim reads secondaire roster:
select count(*) from public.teacher_years where section = 'secondaire';
rollback;"
```

Expected: count `0` (row hidden). Then repeat with an insert into `secondaire`:
Expected: `ERROR: new row violates row-level security policy`. (Get `<admin.prim-uuid>` from `select id from auth.users where email='admin.prim@siloe.edu'` — print UUIDs only, never secrets.)

- [ ] **Step 3: Checkpoint review** — migration applies cleanly, backfill counts match, RLS blocks cross-section read + write. Do not commit.

---

### Task 2: `src/lib/roster.ts` helper module

**Files:**
- Create: `src/lib/roster.ts`
- Test: none (thin Supabase wrappers; exercised through Task 6 browser passes)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`.
- Produces (used by Tasks 3–5 — exact names/signatures, do not rename):
  - `seedRosterForYear(supabase, schoolYearId: string): Promise<void>` — upserts one active row per `user_roles` enseignant row (with section) for the given year: `.upsert(rows, { onConflict: "user_id,school_year_id,section" })`.
  - `seedRosterForUser(supabase, userId: string): Promise<void>` — for each of the user's enseignant sections, upserts active rows for the active + upcoming years (years found by `status in ('active','upcoming')`; no years → no-op).
  - `setRosterActive(supabase, input: { userId: string; schoolYearId: string; section: "primaire" | "secondaire"; isActive: boolean }): Promise<void>` — upsert single row with the flag.
  - `isRosterMember(supabase, input: { userId: string; schoolYearId: string; section: "primaire" | "secondaire" }): Promise<boolean>` — true when an active row exists (added during execution to avoid duplicating the check across six call sites).
  - `orphanAssignments(supabase, schoolYearId: string, section: "primaire" | "secondaire"): Promise<{ attributionOrphans: { id: string; classe: string; cours: string; teacherName: string }[]; titulaireOrphans: { classId: string; className: string; teacherName: string }[] }>` — attributions whose `enseignant_id` has no active roster row for (year, section), plus classes whose `titulaire_id` has none. Teacher names resolved via `profiles`.

- [ ] **Step 1: Create `src/lib/roster.ts`** with the four functions above. Section type: import `type { Section }` from `@/lib/auth` — do not redeclare the union.
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/dev"`. Expected: no output lines.
- [ ] **Step 3: Checkpoint review** — signatures match this plan exactly.

---

### Task 3: Seeding — year creation + user creation

**Files:**
- Modify: `src/app/(app)/admin/annee/actions.ts` (`createYearForRevision`, after clone block, before `revalidatePath` — currently around line 140)
- Modify: `src/app/(app)/admin/utilisateurs/actions.ts` (`createUser` after roles insert; `importUsersCsv` per teacher row)
- Consumes: `seedRosterForYear`, `seedRosterForUser` from Task 2.

**Interfaces:** No signature changes. `createYearForRevision` still returns `{ id }` / `{ error }`.

- [ ] **Step 1: Seed on year creation.** In `createYearForRevision`, after the clone steps succeed:

```ts
await seedRosterForYear(supabase, yearId);
```

Wrap so a seed failure surfaces instead of silently passing:

```ts
try {
  await seedRosterForYear(supabase, yearId);
} catch (e) {
  return { error: e instanceof Error ? e.message : "Échec de l'initialisation du personnel." };
}
```

- [ ] **Step 2: Seed on user creation.** In `createUser`, after the `user_roles` inserts for the new user id, and in `importUsersCsv` after each created teacher's role inserts. (Executed: `importUsersCsv` delegates to `createUser` so one insertion point covers both; `updateUser` seeds too — a promoted teacher would otherwise stay unassignable.)

```ts
await seedRosterForUser(supabase, newUserId);
```

Best-effort: wrap in try/catch that logs but does not fail user creation (a missing active/upcoming year is a normal no-op, and the next year creation backfills from roles anyway — spec §6).

- [ ] **Step 3: Typecheck + lint changed files**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/dev"` (expected: clean) and `npx eslint "src/app/(app)/admin/annee/actions.ts" "src/app/(app)/admin/utilisateurs/actions.ts"` (expected: no errors).
- [ ] **Step 4: Checkpoint review.**

---

### Task 4: Roster-filtered assignment dropdowns + server guards

**Files:**
- Modify: `src/app/(app)/[section]/structure/page.tsx` (teacher options query, ~line 54)
- Modify: `src/app/(app)/[section]/attributions/page.tsx` (teacher options query, ~line 55)
- Modify: `src/app/(app)/[section]/structure/actions.ts` (`createClass`, `updateClass`, CSV import ~line 94)
- Modify: `src/app/(app)/[section]/attributions/actions.ts` (`createAttribution`, `updateAttribution`, CSV import ~line 134)

**Interfaces:** No prop changes. Pages keep passing `teachers` / `teacherOptions`; the arrays just contain only roster-active teachers for the selected year.

- [ ] **Step 1: Filter the page queries.** After fetching `teacherRoles` in each page, fetch the year's active roster and intersect:

```ts
const { data: roster } = yearId
  ? await supabase
      .from("teacher_years")
      .select("user_id")
      .eq("school_year_id", yearId)
      .eq("section", section)
      .eq("is_active", true)
  : { data: [] };
const rosterIds = new Set((roster ?? []).map((r: { user_id: string }) => r.user_id));
const activeTeacherRoles = (teacherRoles ?? []).filter((t: { user_id: string }) => rosterIds.has(t.user_id));
```

Use `activeTeacherRoles` in place of `teacherRoles` for `teachers` / `teacherOptions` (and the titulaire name lookup, so departed titulaires render "— (à désigner)" instead of a name that can no longer be chosen).

- [ ] **Step 2: Guard the actions.** At the top of `createClass`/`updateClass` (when `titulaire_id` is non-null) and `createAttribution`/`updateAttribution` (always) plus both CSV import loops, verify membership:

```ts
const { data: member } = await supabase
  .from("teacher_years")
  .select("user_id")
  .eq("user_id", input.enseignant_id)
  .eq("school_year_id", input.school_year_id)
  .eq("section", section)
  .eq("is_active", true)
  .maybeSingle();
if (!member) return { error: "Cet enseignant ne fait pas partie de l'année sélectionnée." };
```

(Use `input.titulaire_id` and the same message in structure/actions.ts. The `section` and `school_year_id` values are already available in each action's inputs/page context — thread them from the existing parameters, do not add new required params to client-called signatures; read them from the row being updated where applicable.)

- [ ] **Step 3: Typecheck + lint** — same commands as Task 3 Step 3 for the four files. Expected: clean.
- [ ] **Step 4: Checkpoint review.**

---

### Task 5: Révision Personnel review + gates

**Files:**
- Modify: `src/app/(app)/admin/revision/page.tsx` (fetch roster + orphans per section via Task 2 `orphanAssignments`; pass into `RevisionData`)
- Modify: `src/components/revision/revision-view.tsx` (Personnel block per section card + orphan banner + toggle wiring to a new action)
- Modify: `src/app/(app)/admin/annee/actions.ts` (`validateSection` orphan gate; `activateYear` orphan gate)
- Consumes: `orphanAssignments`, `setRosterActive` from Task 2.

**Interfaces:**
- Extend `RevisionData` with `roster: Record<Section, { userId: string; name: string; isActive: boolean; assignmentCount: number }[]>` and `orphans: Record<Section, { attributionOrphans: { id: string; classe: string; cours: string; teacherName: string }[]; titulaireOrphans: { classId: string; className: string; teacherName: string }[] }>`.
- New action in `annee/actions.ts`: `export async function setTeacherYearActive(input: { userId: string; schoolYearId: string; section: Section; isActive: boolean }): Promise<Result>` — allows section admin of that section OR super admin (check explicitly; RLS update policy permits section admins, super admin bypasses via `is_super_admin()` only on select — so enforce the super-admin path with `requireSuperAdmin()` fallback logic inside the action, then call `setRosterActive`).

- [ ] **Step 1: Gate `validateSection`.** After the existing validation logic, before writing the row:

```ts
const orphans = await orphanAssignments(supabase, input.yearId, input.section);
const n = orphans.attributionOrphans.length + orphans.titulaireOrphans.length;
if (n > 0) {
  const names = [...new Set([
    ...orphans.attributionOrphans.map((o) => o.teacherName),
    ...orphans.titulaireOrphans.map((o) => o.teacherName),
  ])].join(", ");
  return { error: `${n} cours sont encore assignés à des enseignants hors roster (${names}).` };
}
```

- [ ] **Step 2: Gate `activateYear`.** After the 2/2 validations check (~line 130), loop both sections with `orphanAssignments`; refuse with `L'activation est verrouillée : des cours sont assignés à des enseignants hors roster.` if any orphans exist.
- [ ] **Step 3: RevisionView Personnel block.** (Executed as shared `src/components/roster/roster-block.tsx` used by both Révision and the Structure strip — no fork.) Per section card, above the structure table: roster rows (name, assignment count, active toggle calling `setTeacherYearActive` then `router.refresh()`); the roster list is scrollable (`max-height` + `overflow-y: auto` — account lists grow) with a name search box (client-side filter; orphan counts always computed on the full roster); the structure table keeps its existing text + Cours + Enseignant filters and is scrollable like the roster list; orphan banner when counts > 0 with affected teacher names and a link to `/[section]/attributions` and `/[section]/structure` for reassignment. Super admin sees both sections read-only except toggles (super admin may toggle). Section admin sees their section card full-width plus a slim status strip for the other section (mockup écran 17, Comment 3 fix — no stretched blank column).
- [ ] **Step 4: Typecheck + lint** the three files. Expected: clean.
- [ ] **Step 5: Checkpoint review.**

---

### Task 5b: Roster strip on the Structure page (approved 2026-09-11)

Same toggle component as
Task 5 Step 3, rendered in a compact strip above the class list in
`[section]/structure/page.tsx` (both sections share the page — it is already
section-parametrized), filtered to the page's selected year. Toggles call the
same `setTeacherYearActive` action from Task 5. Active-year orphans render as a
warning chip with a count (non-blocking, per spec Decision 1); upcoming-year
orphans render as the blocking banner (same component, `blocking` prop).

- [ ] **Step 1: Implement strip + wire toggles** (reuse Task 5 component verbatim — do not fork it).
- [ ] **Step 2: Typecheck + lint**, then checkpoint review.

---

### Task 6: Full verification

- [ ] **Step 1: Static gates** — Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/dev"` (clean), `npm test` (37/37 plus any new tests), `npx eslint` on every file touched in Tasks 1–5 (no errors; the pre-existing `any` at `[section]/structure/page.tsx:75` is out of scope — do not touch it).
- [ ] **Step 2: RLS simulation** — Task 1 Step 2 queries re-run green after all migrations.
- [ ] **Step 3: Browser passes** (temp `scripts/verify-roster-*.mjs`, delete afterwards; super admin `direction@siloe.edu`, section admins `admin.prim@siloe.edu` / `admin.sec@siloe.edu`, password `Test1234!`; port 3001):
  1. Create upcoming year → roster rows exist per teacher (psql count check).
  2. Section admin deactivates a teacher in Révision → teacher gone from Structure/Attributions dropdowns for the upcoming year, still present for the active year.
  3. Orphan banner appears; "Valider ma section" refuses with names + count.
  4. Reassign orphaned attributions → banner clears → validation succeeds → activation succeeds.
  5. New user created in Utilisateurs with enseignant role → assignable in active + upcoming years immediately.
  6. Restore test data afterwards (only 2026–2027 active remains).
- [ ] **Step 4: Report results; await user approval for the final commit.** Do not commit.

---

## Self-Review

1. **Spec coverage:** §4.1→Task 1; §5.1→Task 3 Step 1; §5.2→Task 3 Step 2; §5.3→Task 4; §5.4→Task 5 Step 3; §5.5→Task 5 Steps 1–2 (+ active-year warning chip folded into Task 5 Step 3 banner logic — active-year orphans render as warning, non-blocking); §5.6→no task (correct); §6 edge cases→handled in Task 1 (cascades, backfill, conflict), Task 3 Step 2 (no-year no-op), Task 5 (section moves via two toggles); §7 criteria→Task 6.
2. **Placeholder scan:** all steps carry concrete code/commands; file paths and line anchors are exact as of 2026-09-11.
3. **Type consistency:** `Section` imported from `@/lib/auth` everywhere; helper names (`seedRosterForYear`, `seedRosterForUser`, `setRosterActive`, `orphanAssignments`) identical across Tasks 2–5; `RevisionData` extension keys match producer (page.tsx) and consumer (revision-view.tsx).
