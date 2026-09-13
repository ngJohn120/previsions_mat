# Per-Year Teacher Roster — Specification (v1, draft)

**Date:** 2026-09-11
**Status:** DRAFT — awaiting approval. No code has been written against this spec.
**Repo:** `Prevision_WebApp` (Next.js + Supabase, dev on port 3001)
**Docs in English; UI strings in French.**

---

## 1. Problem

Teaching personnel changes every school year (departures, new hires, section moves),
but the app models teachers globally:

- `user_roles(role='enseignant', section)` and `profiles` have **no year dimension**.
- `createYearForRevision` + `cloneStructure` copy `titulaire_id` / `enseignant_id`
  verbatim into the new year (`src/app/(app)/admin/annee/actions.ts:205,231`).
- Assignment dropdowns (Structure titulaires, Attributions dialog) list **all**
  teacher accounts regardless of year.

Consequence: a teacher who left over the holidays silently keeps every class in the
new year, and a new hire is invisible until someone hand-edits each attribution.
The section admin has no roster review step before validating the new year.

## 2. Goals

1. Record **who teaches in which school year**, per section, without touching
   login accounts or historical data.
2. Make the new-year preparation surface departed teachers as **orphaned
   assignments** that must be resolved before a section can validate.
3. Prevent *new* assignments (titulaire or attribution) to teachers who are not
   on the selected year's roster — UI filtering **plus** server-side guards.
4. Zero extra clicks in the common case (stable personnel): seeding is automatic.

## 3. Non-goals

- No changes to existing tables or columns. No backfill of semantic meaning into
  `profiles.disabled` (it stays what it is: login/account deactivation).
- No per-year roles/permissions: a teacher's *section* and *login rights* stay
  global. Only *roster membership* is per-year.
- No automatic account creation/deletion. Hiring/firing people stays manual in
  Utilisateurs; the roster only tracks year participation.
- No changes to fiches, printing, offline sync, or the calendar.

## 4. Data model

### 4.1 New table `teacher_years` (migration `0013`)

```sql
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
```

Notes:
- `section` mirrors the teacher's `user_roles` section at seed time. A teacher who
  moves sections gets a new row for the new section (old row deactivated).
- `on delete cascade` on both FKs: deleting a user or an upcoming empty year
  cleans up silently. History years are never deleted, so history is safe.
- Backfill in the same migration: one active row per (`enseignant` role row ×
  every existing school year).

### 4.2 RLS (mirror `0012_year_section_validations.sql` + `ENABLE ROW LEVEL SECURITY`)

- `select`: super admin all; section admin own section only
  (`is_super_admin() or is_section_admin(section)`).
- `insert` / `update`: section admin of that section only.
- `delete`: nobody via RLS-dependent paths — rows are deactivated (`is_active=false`),
  never deleted, except by cascade. (No delete policy = denied by default.)

## 5. Behaviors

### 5.1 Year creation (`createYearForRevision`, annee/actions.ts)

After the year row + optional clone succeed, insert active `teacher_years` rows for
the new year: one per existing `user_roles` row with `role='enseignant'`
(preserving each row's section). Runs for cloned **and** blank years.
Failure to seed does not fail year creation but must surface an error string.

### 5.2 Utilisateurs (super admin)

- `createUser`: when the new account gets an `enseignant` role, also insert active
  roster rows for the **active and upcoming** years (looked up dynamically, not
  hardcoded). If no active/upcoming year exists, skip silently.
- `importUsersCsv`: same rule per imported teacher row.
- `toggleActive` (disable login): unchanged semantics — but the UI adds a hint
  that the person also needs deactivation on upcoming-year rosters (see §5.4).
- No year filter on the user list itself: users stay global (audited 2026-09-11 —
  the page holds no year-scoped data).

### 5.3 Assignment surfaces (Structure + Attributions, per selected year)

Pages already resolve the switcher year (cookie `pm_year`, fixed 2026-09-11).
Change the teacher option queries in both `[section]/structure/page.tsx` and
`[section]/attributions/page.tsx`: inner-join `user_roles(enseignant, section)`
with `teacher_years(school_year_id = selected, section, is_active = true)`.
Result: departed teachers vanish from dropdowns; the "Titulaire : — (à désigner)"
empty state appears instead.

Server-side guards (both `structure/actions.ts` and `attributions/actions.ts`,
on create + update + CSV import paths):
- Reject `titulaire_id` / `enseignant_id` values with no active roster row for
  (`school_year_id`, section). Error (French): for titulaires
  « Cet enseignant ne fait pas partie de l'année sélectionnée. »,
  for attributions « Cet enseignant ne fait pas partie de l'année sélectionnée. »
- Guards check membership only — they do not check `profiles.disabled`
  (a disabled account with an active roster row is a data inconsistency the
  Révision review surfaces, not something assignment flows must solve).

### 5.4 Révision page — Personnel review (per section card)

New "Personnel" block inside each section card, above the structure table:

- Roster list for (upcoming year, section): name, assignment count
  (titulaires + attributions), active toggle. The list is scrollable
  (`max-height` + `overflow-y`) and has a name search box (filters client-side;
  orphan math always runs on the full list, never on the filtered view).
- **Orphan banner** when attributions/titulaires in the upcoming year point to
  teachers with no active roster row: « N cours assignés à des enseignants qui
  ne font plus partie de l'année — réassignez-les avant de valider. » with the
  affected rows highlighted in the structure table.
- Reassignment happens in the existing Structure/Attributions pages (filtered
  dropdowns per §5.3); Révision links to them. No inline editing in Révision.
- Orphan count = 0 is part of "clean". Toggling a teacher inactive who still
  holds assignments is allowed but immediately surfaces as orphans (no silent state).

### 5.5 Validation + activation gates

- `validateSection(yearId, section)`: refuse when the section has orphan
  assignments for that year. Error includes the count and teacher names, e.g.
  « 3 cours sont encore assignés à des enseignants hors roster (N. Mbuyi). »
- `activateYear(yearId)`: refuse when **any** section has orphans (defense in
  depth — UI already disables the button until 2/2 validations, which now imply
  zero orphans).
- Mid-year departures (toggling inactive on the **active** year): allowed; existing
  assignments keep working (no destructive cascade, fiches keep their teacher);
  only *new* assignments are blocked by §5.3 guards. A warning chip shows the
  count, but nothing is locked.

### 5.6 Untouched surfaces (explicitly out of scope)

- Mes fiches / Suivi / Export: read paths keyed off attributions — they follow
  automatically. A departed teacher's *old-year* fiches remain readable.
- Fiche editor, consultation, conflits, impression, calendrier, notifications,
  branches, offline sync: no year-roster interaction.

## 6. Edge cases

| Case | Resolution |
|---|---|
| Teacher moves primaire → secondaire between years | Deactivate old-section row, insert active new-section row (manual toggle in Révision Personnel; spec the UI as two toggles) |
| Same person teaches in both sections | Two rows (PK includes section); independent toggles |
| Year created while a teacher account is `disabled` | Still seeded active (roster ≠ login); Révision flags disabled+active as a warning, non-blocking |
| Upcoming year deleted (`deleteUpcomingYear`) | Roster rows cascade away with the year |
| User deleted | Roster rows cascade away |
| No active/upcoming year at `createUser` time | Skip roster insert; next year creation seeds from roles (§5.1) so nobody is lost |
| Double-seed (retry after partial failure) | PK makes inserts idempotent via upsert (`on conflict do update set is_active=true`) |

## 7. Acceptance criteria

1. New year (cloned or blank) contains one active roster row per current teacher,
   per their section.
2. Deactivating a teacher for the upcoming year removes them from Structure and
   Attribution dropdowns for that year only; the active year is unaffected.
3. Cloned assignments pointing at deactivated teachers appear as orphans in
   Révision; `validateSection` refuses with names + count until reassigned.
4. `activateYear` refuses when orphans exist in any section.
5. Toggling inactive on the active year never deletes or reassigns existing
   attributions/fiches; only new assignments are blocked.
6. New teacher created in Utilisateurs is assignable in active + upcoming years
   with no further steps.
7. RLS: section admin cannot read or modify the other section's roster rows
   (verified by direct SQL simulation as done for 0012).
8. Gates: `npx tsc --noEmit` clean, `npm test` 37/37 (plus any new tests), live
   browser pass as teacher + both section admins + super admin.

## 8. Decisions (approved 2026-09-11 — with practical examples)

### Decision 1 — A teacher leaves *mid-year* (active year, not the upcoming one)

**Scenario.** It is February 2027; 2026–2027 is active. Mbuyi Kabongo resigns.
The admin opens Révision… but Révision only ever shows the *upcoming* year, so the
toggle happens elsewhere (see Decision 1-bis below — for now assume a toggle on the
active year's roster). The admin flips Mbuyi to inactive for 2026–2027.

**What happens (spec default — warning chip only):**
- His 3 attributions (6e B / 6e A / 5e B · Français) keep working untouched.
  His fiches stay readable, his submitted work stays submitted — nothing is
  deleted or reassigned behind anyone's back.
- He disappears from the titulaire/enseignant dropdowns, so no *new* class can
  be given to him.
- A warning chip appears on the Attributions page: « 3 cours assignés à un
  enseignant inactif cette année (Mbuyi Kabongo) ». Non-blocking.
- The replacement (say, Kazadi Mutombo takes 6e B) is done by editing the 2–3
  attributions in the Attributions page, exactly as today. The chip clears itself.

**The alternative** would be inventing a "re-validation" workflow for the active
year (lock the section until orphans are cleared, like the upcoming-year gate).
That is a whole new concept — nothing in the app re-validates an active year
today — and it would punish urgent mid-year fixes with bureaucracy. Default:
no lock, just the chip.

### Decision 1-bis — Where does the active-year toggle live?

The Personnel block in this spec sits in Révision, which only ever shows the
*upcoming* year — so mid-year deactivation needs a home. Two options:
- **(a, recommended)** A compact roster strip on the Structure page per section
  (same toggle component, filtered to the selected year — it works for active
  and upcoming alike since Structure is now switcher-aware).
- **(b)** A year selector inside Révision to also review the active year.
  More power in one place, but Révision's whole contract is "prepare the *new*
  year" — mixing the active year in dilutes it.
Default: (a).

### Decision 2 — Login disabled in Utilisateurs, but roster row still active

**Scenario.** The direction fires (or the secretary *thinks* someone left) and
clicks « Désactiver » on Mbuyi Kabongo in Utilisateurs. He can no longer log in.
But his roster row for 2027–2028 — seeded automatically at year creation — is
still active, and 3 cloned attributions still point at him.

**Spec default — non-blocking warning, two separate gestures:**
- Révision shows, next to his roster row: « Compte désactivé — toujours sur le
  roster » (amber, non-blocking; see mockup écran 17, teacher Tshisekedi).
- The admin then makes two conscious decisions: (a) deactivate him on the roster
  → his courses become orphans → reassign; (b) re-enable the login if it was a mistake.
- **Why not auto-deactivate? Practical trap:** the school has two « Mbuyi » on
  staff (Kabongo and Ilunga). The secretary clicks the wrong one. With
  auto-deactivate, 5 courses instantly become orphans, validation locks, and the
  admin must investigate. With a warning, the mistake is visible (« compte
  désactivé » flag on a teacher everyone knows is present) and one click in
  Utilisateurs fixes it — zero collateral.

**The alternative** (auto-deactivate roster on login disable, auto-reactivate on
re-enable) saves one click in the true-departure case but couples two different
meanings — "may this person log in" vs "does this person teach this year"
(maternity cover, suspension, and namesake errors all break the equivalence).
Default: keep them separate, warn loudly.
