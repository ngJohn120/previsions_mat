# Plan Review — Calendar Editing (MoA review pass)

- **Date:** 2026-09-09
- **Reviewed plan:** `docs/superpowers/plans/2026-09-09-calendar-editing.md`
- **Context:** Requested review for inconsistencies, logical holes, and incorrect assumptions before execution.
- **Status:** Findings below are the review as issued. All 17 have since been **resolved** — see the resolution appendix at the end. The plan was rewritten accordingly the same day.

---

## Overall verdict (as issued)

The plan has a sound high-level structure, but the following items must be resolved before implementation.

## Critical issues

### 1. `row_uuid` is assumed but not verified on `template_rows`

The plan builds its editing identity around `template_rows.row_uuid`, but the current `src/lib/calendar.ts` `RowSeed` type does not contain `row_uuid`.

The plan must first verify the actual schema:

```sql
\d template_rows
```

If `template_rows` has no `row_uuid`, the implementation must either:

- use the existing primary key `id` consistently, or
- add a migration and backfill `row_uuid`.

The plan currently says "no migration needed" without establishing that assumption.

### 2. Identity handling mixes `id` and `row_uuid`

The plan alternates between `selected.id`, `rowId`, and `row_uuid`. The pure helpers use `row_uuid`, while database updates are described as using `id`. The mapping between both identities is not defined.

This creates a real risk of updating or deleting the wrong row. The plan should choose one identity for the UI/action contract:

- use database `id` for all editing actions and helper operations, unless `row_uuid` is confirmed as the canonical template-row identity; or
- carry an explicit `{ id, row_uuid, ...row }` structure throughout every operation.

### 3. Insert-week date logic creates duplicate or overlapping weeks

The plan derives the inserted week as `anchor end + 3 days`. For `A: 07/09 → 11/09` followed by `B: 14/09 → 18/09`, the inserted week becomes `14/09 → 18/09` — duplicating B exactly. The plan's own test expects this in one place while describing another date result elsewhere. The grid indexes rows by parsed dates, so a collision makes one week unselectable.

The plan needs a clear rule: shift later weeks +7, blank dates + immediate entry, or derive from the following row with shifting.

### 4. Head insertion duplicates the first week

The head-insert rule reuses the first row's dates, creating two rows with the same range. A head insertion should derive `first start − 7 → first end − 7` or require user-entered dates before saving.

### 5. Delete does not define what happens to later dates

Deleting a week leaves a 7-day hole unless later rows shift backward. The plan resequences week numbers but does not define date compaction. Insert and delete need explicit date semantics, not only `ordre`/`semaine_num` changes.

### 6. "Reorder" is not actually implemented

The requirement included reordering weeks/events. The plan provides insert/delete/renumber/shift but no `moveRow` operation. Deleting and recreating a row is not equivalent to moving it (identity, dates, event metadata can change). Add an explicit move operation, or narrow the requirement and confirm that renumbering is sufficient.

## Important behavioral gaps

### 7. `mois` becomes stale after date edits

After shifting a row into October, `mois` could still read `"Septembre"`. The update and shift actions should derive `mois` from the new start date, with Sept→Oct and Dec→Jan tests.

### 8. Manual date edits have no validation rules

No validation for start > end, overlapping adjacent rows, invalid labels, or whether one edit should shift later rows. The plan holds two competing semantics (single-row edit vs cascading shift) that must be explicit in UI and action contracts.

### 9. Shift behavior is potentially surprising

`shiftWeekDates` moves the selected row **and every subsequent row including events**. Correct perhaps, but it must be stated explicitly in the plan and surfaced in the UI.

### 10. Event insertion receives a five-day teaching-week range

`insertEventAfter` reuses the week-date derivation, producing a Mon–Fri range for exams/vacations. Better defaults: single-day, copy the anchor date, or blank dates requiring entry.

## Data integrity and authorization gaps

### 11. Foreign-key behavior is not checked

The plan promises existing fiches stay untouched but never checks whether `fiche_rows` references `template_rows`. Restrictive FKs could make deletion fail; snapshots should be documented and tested:

```sql
SELECT conname, conrelid::regclass, confrelid::regclass, confdeltype
FROM pg_constraint
WHERE contype = 'f'
  AND (conrelid::regclass::text LIKE '%fiche%' OR confrelid::regclass::text = 'template_rows');
```

### 12. Partial failures can leave the template inconsistent

Insert/delete + reload + per-row resequence updates: if one update fails, duplicate `ordre` values or wrong week numbers can remain. Needs atomicity (RPC transaction or equivalent).

### 13. Super-admin guards are asserted, not verified

The plan claims page and actions already enforce super-admin access without confirming. Define behavior per role: super admin (editable), section admin (read-only/redirected), unauthenticated (login redirect). Edit controls should not merely appear and fail on submit.

### 14. Active template version ID is not clearly threaded

Actions require `templateVersionId`, but the plan doesn't state how the page obtains and passes it. The page should return `{ activeTemplateVersionId, rows, section, ... }` and pass it to the client component explicitly.

### 15. `row_uuid` generation in shared calendar helpers is questionable

`crypto.randomUUID()` inside `src/lib/calendar.ts` (pure, possibly client-imported) is misplaced. Identity generation belongs in the server action or DB; pure helpers should accept an injected UUID factory.

### 16. Missing stale-selection handling

After deleting the selected row and refreshing, the panel may keep a stale row object and show controls for a row that no longer exists. Clear selection after delete; reset the form after insert/update.

### 17. Existing fiche verification is too weak

Comparing only `fiche_rows` counts doesn't prove fiches untouched. Compare a representative fiche's row content before/after: row IDs, dates, column keys, entered values.

## Conclusion (as issued)

The plan has a sound high-level structure, but these items must be resolved before implementation:

1. Confirm `template_rows` identity/schema.
2. Standardize `id` versus `row_uuid`.
3. Define insert/delete date-compaction behavior.
4. Add or remove explicit row movement.
5. Recompute `mois` after date changes.
6. Define date validation and cascade semantics.
7. Verify foreign keys before allowing deletion.
8. Make structural mutations transactional.
9. Clearly gate the editing UI by role.
10. Thread the active template version ID explicitly.

---

## Appendix — Resolution status (2026-09-09, post-verification)

Verified against the live schema (`\d template_rows`, `\d fiche_rows`, `pg_constraint`) and the actual sources (`actions.ts`, `templates.ts`, `page.tsx`), plus five explicit user decisions. The plan was rewritten (`docs/superpowers/plans/2026-09-09-calendar-editing.md`) with all of these baked in.

| # | Finding | Resolution |
|---|---|---|
| 1 | `row_uuid` unverified | **Verified**: exists, `NOT NULL`, `UNIQUE(template_version_id, row_uuid)`, minted at insert. No migration. |
| 2 | `id` vs `row_uuid` mix | Contract fixed: actions/UI pass DB `id`; helpers key on `id` after the action maps fetched rows; `row_uuid` minted fresh on insert (fiche-matching identity for `applyTemplateVersionToFiches`). |
| 3 | Insert duplicates next week | **User decision #1**: insert week shifts all subsequent rows **+7 days** (year end slides). Dates derived: next Monday strictly after anchor end. |
| 4 | Head insert duplicates first week | Head insert = `first.start − 7`; all rows shift +7. |
| 5 | Delete leaves a hole | **User decision #2**: deleting a teaching week shifts later rows **−7 days** (gap closes). Event delete shifts nothing. |
| 6 | No move/reorder | **User decision #4**: no move buttons — insert at position + delete covers repositioning. |
| 7 | `mois` staleness | Every date-changing op recomputes `mois` from the new start ( enseignement rows); Sept→Oct and Dec→Jan tests specified. |
| 8 | No validation | Manual date edit touches **only that row**; validated start ≤ end client- and server-side with inline French error. |
| 9 | Surprising shift | Cascade semantics documented; UI hint "décale toutes les lignes suivantes" on the shift buttons. |
| 10 | 5-day event default | **User decision #3**: event defaults to a **single day** on the anchor week's Monday; widened in the panel. |
| 11 | FK risk | **Verified safe**: `fiche_rows` is a snapshot table; **no FK references `template_rows`** (FKs only fiches→attributions, fiches→school_years, fiche_rows→fiches, fiche_cells→fiche_rows). |
| 12 | Atomicity | **User decision #5**: sequential writes + idempotent resequence (no migration); limitation documented (mid-cascade crash → partially-shifted dates, self-heals via resequence/panel edit). |
| 13 | Guards unverified | **Verified**: `calendrier/page.tsx` redirects non-super-admins; `requireCalendarAdmin()` guards every action. |
| 14 | Version-ID threading | `activeTemplateVersionId` threaded explicitly from `page.tsx` into `CalendarManager`. |
| 15 | `crypto.randomUUID` in pure helpers | Helpers stay pure (no crypto); actions inject identity. Server-side use already established in `templates.ts`. |
| 16 | Stale selection | `setSelected(null)` after delete; form state keyed by `selected.id`. |
| 17 | Weak fiche verification | Task 4 verifies content-identical `fiche_rows` (`row_uuid`/`ordre`/`semaine_num`/`date_label` + `fiche_cells` count) before/after edits, plus a new-attribution check. |

**All 17 findings closed. Plan approved for execution (awaiting the user's choice of execution mode).**
