# Calendar Generation Wizard — Specification (v1, draft)

**Date:** 2026-09-12
**Status:** APPROVED 2026-09-12 (modal deleted; `generateCalendar` reused unchanged; inline execution). No code has been written against this spec yet.
**Repo:** `Prevision_WebApp` (Next.js + Supabase, dev on port 3001)
**Binding mockup:** `docs/mockups/17-generation-assistant.html` (Variante A, approved 2026-09-12)
**Docs in English; UI strings in French.**

---

## 1. Problem

Calendar setup for a school year currently lives in a ~384px modal
(`CalendarManager` → `genOpen` dialog, `calendar-manager.tsx:513-542`):
two date inputs + a free-text textarea with a fragile
`libellé | type | jj/mm/aaaa-jj/mm/aaaa` micro-format. A typo in the format
silently produces wrong event dates, and there is no preview before the
template version is written. This is a once-a-year, high-stakes operation
that deserves a full page.

## 2. Goal

Replace the modal with a dedicated 4-step page implementing Variante A:
**1 Paramètres → 2 Événements → 3 Aperçu → 4 Confirmation**, reusing the
existing `generateCalendar` server action unchanged.

## 3. Non-goals

- No changes to week generation math (`buildWeeks`, `generateRowsForSection`),
  versioning semantics (`createNewTemplateVersion` → draft, active untouched),
  event-type vocabulary, or the post-generation calendar editor.
- No batch generation for both sections (that was Variante C — not chosen).
- No changes to `/admin/annee` wizard or Révision.

## 4. Routes & access

- New route: `/admin/calendrier/generer?section=primaire|secondaire`
  (defaults to `primaire`, same rule as the parent page).
- Guard: super admin only (`isSuperAdmin`, redirect otherwise — same as
  `CalendrierPage`).
- Year: top-bar switcher cookie `pm_year` with active-year fallback (same
  resolution block as `calendrier/page.tsx:26-38` — copy, don't refactor).
- Entry point: the parent page's `« + Générer le calendrier »` button becomes
  a link to the new route (section preserved). The modal code is deleted.

## 5. Behaviors

### 5.1 Step 1 — Paramètres

- Read-only: année scolaire label; editable: section select (primaire/secondaire,
  synced to the query param), Rentrée (date, default: year `start_date`),
  Fin d'année (date, default: year `end_date`).
- Info banner when an active template version already exists for (year, section):
  « Un modèle actif existe déjà (v{N}) : la génération créera une v{N+1} et
  l'activera aussitôt — la v{N} sera désactivée. » (Amber — this is the
  point of no return, decided 2026-09-12: generation activates immediately,
  same as the old modal always did.)
- Validation: both dates required, rentrée ≤ fin; error shown inline, no advance.

### 5.2 Step 2 — Événements

- Structured rows (no free-text format): Libellé (text) · Type (fixed select:
  `vacances, évaluation, examen, révision, détente`) · Début (date) · Fin (date)
  · delete button. `+ Ajouter un événement` appends an empty row.
- Validation per row on Continue: libellé non-empty, both dates present,
  début ≤ fin, range within [rentrée, fin] (warn, don't block, when outside? —
  **decision: block**, an event outside the year is always a mistake).
- Empty list is allowed (a year can start with zero events).

### 5.3 Step 3 — Aperçu (client-side, no server round-trip)

- `buildWeeks(rentrée, fin)` from `@/lib/calendar` (pure — already proven
  client-importable) → headline counts: N semaines · M jours de cours ·
  K événements.
- Scrollable week list (condensed with ellipsis for long runs, as in the
  mockup) with event bands mapped onto covered weeks. Band colors reuse the
  calendar editor's event-type colors.
- Navigation: `← Modifier les événements` returns to step 2 with state kept.

### 5.4 Step 4 — Confirmation & generation

- Summary: section · year label · N semaines + K événements · `v{N+1}`.
  Default action = activate immediately (demotes current version, same as the old
  modal). **New:** checkbox « Sauvegarder en brouillon » — when checked, `active`
  sent to `createNewTemplateVersion` is `false`, so the new version is created
  non-active and the current active version is left untouched. Summary text
  switches to « … version {N+1} (brouillon — non activée). La version active
  actuelle reste inchangée. »
- `Générer le calendrier` calls the existing `generateCalendar` action with
  the structured rows (ISO dates — the action parses both ISO and FR formats
  via `parseLabelBounds`; send ISO `yyyy-mm-dd`, already supported).
- Submit follows the hardened pattern (attributions hang lesson): try/catch
  around the action; thrown transport errors surface as
  « La requête n'a pas abouti… » with the button released; returned errors
  display inline.
- On success: `router.push('/admin/calendrier?section=…')` + refresh, where the
  new draft version is visible.

### 5.5 Reprise d'un brouillon (added 2026-09-13, comment on draft v1)

- When the selected version on `/admin/calendrier` is a draft, a secondary
  « Reprendre la création » button links to
  `/admin/calendrier/generer?section=…&resume=<versionId>`.
- The `generer` page loads that draft (same year+section, draft only —
  anything else redirects back to `/admin/calendrier`) and prefills the
  wizard: params from the min/max row dates, events from the `evenement` rows
  (label/type/dates; unknown types fall back to `vacances`). Section is locked
  in resume mode.
- Submit sends `resumeVersionId`: the action verifies the version (same
  year+section, still a draft), replaces its rows in place (no new version
  number), and applies the draft checkbox — so resume is also the path that
  activates a draft. Confirmation copy and button labels switch to
  « Mettre à jour (et activer) ».
- The month grid opens on the displayed model's first dated month (not a
  hardcoded Sept 2026), so a 2027–2028 draft shows its weeks and already-set
  events immediately; switching versions re-jumps and clears row selection.
- Fixed alongside: `?v=` now matches the version id the selector pushes (it
  previously only matched the version number, so deep links never selected).
- Root cause fixed 2026-09-13 (draft v1 events invisible everywhere): the wizard
  sends ISO `yyyy-mm-dd` but `generateCalendar` parsed bounds with
  `parseLabelBounds` (French `DD/MM/YYYY` only), storing `NaN/NaN/NaN` event
  dates. New `parseEventDate` (ISO + legacy FR, null on garbage, unit-tested);
  the action rejects invalid event dates instead of storing them. Drafts saved
  before the fix resurface their events label-first in resume for date repair.
- Draft hygiene (added 2026-09-13): « Supprimer le brouillon » beside
  « Reprendre », draft-only, `confirm()` naming the version + row count;
  `deleteTemplateVersion` refuses active versions; rows deleted first, then the
  version (FK cascades anyway); lands back on the default selection so no empty
  `?v=<dead-id>` view.

### 5.6 Untouched surfaces (explicitly out of scope)

- `buildWeeks`, `generateRowsForSection`, `createNewTemplateVersion`: reused, not
  modified. (`generateCalendar` gained a draft-resume path — see §5.5.)
- Calendar editor (row editing, week frame, events CRUD), year wizard,
  Révision, export: no changes.

## 6. Edge cases

| Case | Resolution |
|---|---|
| No year exists at all | Page shows the same empty-state as parent (« Année scolaire — à créer »); steps hidden |
| Rentrée > fin | Inline error, Continue disabled |
| Event row incomplete on Continue | Inline error naming the row; state kept |
| Event outside [rentrée, fin] | Blocked with message (see §5.2) |
| Concurrent generation (double-click) | `busy` disables the button; action is idempotent enough (creates a new draft version — a double submit would create two drafts; `busy` guard is the defense, same as today) |
| User navigates away mid-wizard | State is local only — nothing is written until step 4 (same guarantee as today: nothing writes before Générer) |

## 7. Acceptance criteria

1. Modal gone from `calendar-manager.tsx`; its button links to the new route
   with the current section.
2. Full flow as super admin on the dev DB: params → 2 events → preview counts
   match `buildWeeks` math → generate → parent page shows the new version as
   ACTIVE and the previous one demoted (immediate activation — same as the old
   modal). Restore afterwards: delete the test version + rows, reactivate the
   previous version.
3. Structured events produce identical rows to the old textarea format for the
   same input (verified by generating from the mockup's 3 sample events and
   comparing week/event mapping with the pre-existing v3).
4. Validation errors (bad dates, incomplete row, out-of-range event) all render
   inline in French; no eternal spinner on transport failure (try/catch).
5. Gates: `npx tsc --noEmit` clean, `npm test` green, eslint on touched files
   shows zero new warnings, live browser pass.

## 8. Assumption (confirm on approval)

- The modal is **deleted**, not kept alongside the page. (Your comment reads
  this way — « a dedicated page of its own is more appropriate » — flagging
  explicitly since it's one-way once the code is gone.)
