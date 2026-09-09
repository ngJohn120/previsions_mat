# Calendar Editing (mid-year adjustments) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the super admin fine-tune an existing active calendar (edit a row's dates/labels, shift weeks, insert or delete weeks/events) from the calendar page's side panel, leaving already-created fiches untouched.

**Architecture:** Extend `src/app/(app)/admin/calendrier/actions.ts` with edit actions scoped to the active template version. Pure helpers (renumber/resequence/insert/delete/shift with cascade) in `src/lib/calendar.ts`, unit-tested. Side panel in `calendar-manager.tsx` becomes an editing form. **No DB migration** (user decision #5: sequential writes + idempotent resequence).

**Tech Stack:** Next.js server actions, Supabase (existing tables), React client component, vitest.

## Global Constraints

- Super admin only — VERIFIED: `calendrier/page.tsx` redirects non-super-admins (`if (!isSuperAdmin(user.roles)) redirect("/")`) and `requireCalendarAdmin()` guards every action in `actions.ts`. Do not weaken.
- Existing fiches stay untouched — VERIFIED SAFE: `fiche_rows` is a snapshot table (copied columns incl. its own `row_uuid`); **no FK references `template_rows`** (checked `pg_constraint`: FKs only `fiches→attributions`, `fiches→school_years`, `fiche_rows→fiches`, `fiche_cells→fiche_rows`). Structural edits cannot touch fiches. New attributions pick up the edited template because `createAttribution` reads the active version at creation time.
- UI strings in French; docs/discussion in English.
- Scope: fine-grained edits only — no fiche propagation, no new full-regenerate UI, **no move/reorder buttons** (user decision #4: insert+delete covers repositioning).
- No auto-commit; remind the user to approve a commit at the end.

## Verified schema facts (do not re-verify, but rely on them)

- `template_rows`: `id uuid PK`, `template_version_id uuid FK→template_versions ON DELETE CASCADE`, `row_uuid uuid NOT NULL` with `UNIQUE(template_version_id, row_uuid)`, `ordre int NOT NULL`, `row_type text` ∈ {enseignement, evenement}, `mois text`, `semaine_num int`, `date_label text`, `periode_label text`, `evenement_label text`. RLS: all four ops super-admin-only (`is_super_admin()`), SELECT for authenticated.
- `row_uuid` is the **fiche-matching identity**: `applyTemplateVersionToFiches` matches template rows to fiche rows by `row_uuid` to preserve cell content. ⇒ when inserting a row, mint a **fresh** `row_uuid` (crypto.randomUUID, same pattern as `createNewTemplateVersion`) so it never collides with a fiche's content row.
- Identity contract: **DB/edge identity is `id`** (actions take `rowId` = `template_rows.id`); **helpers key on `row_uuid`** (stable across a resequence that rewrites `ordre`). Actions map one→the other after the initial select. UI never sees or sends `row_uuid`.

## Date semantics (user decisions #1–#3 — normative)

- **`date_label` format:** `"DD/MM/YYYY → DD/MM/YYYY"` (single-day events: same date both sides).
- **Insert teaching week after anchor:** new week occupies the anchor's successor slot — start = **next Monday strictly after the anchor's end** (Fri +3 in the common case), end = start + 4. **All rows after the new row shift +7 days** (weeks AND events — the whole timeline slides; year end date slides; no hard block). Renumber + resequence. UI always anchors on the selected row (`afterRowId = selected.id`). Helper head case (`afterRowId = null`, not reachable from the UI): new week slots into the empty space before the first row (start = first row's start − 7, end = start + 4) and **nothing shifts** — the calendar extends earlier, still continuous.
- **Delete teaching week:** remove it, **all later rows shift −7 days** (gap closes, year ends earlier). **Delete event:** remove only; no date shift (decision #2 was scoped to teaching weeks).
- **Insert event after anchor:** single-day event on the **Monday of the anchor's start-date week** (`start = end = mondayOfWeek(anchor.start)`); no cascade. Admin widens the range in the panel afterwards.
- **Shift (±N days) buttons:** shift the selected row and **every later row** (cascade, weeks AND events); UI labels this explicitly ("décale toutes les lignes suivantes").
- **Manual date edit:** touches **only that row**. Validation: both dates parse AND start ≤ end (else inline error, no save). `mois` recomputed from the new start for enseignement rows.
- **`mois` invariant:** whenever an enseignement row's `date_label` changes by any operation (shift/insert-cascade/delete-cascade/manual edit), `mois` = `monthLabel(new start)`. Event rows keep `mois = null` always.
- **Resequence invariant (every structural op):** `ordre` = list position (1-based); `semaine_num` = 1..n over enseignement rows in list order; events keep `semaine_num = null`.
- **Known limitation (accepted, user decision #5):** structural ops = sequential writes. A crash mid-cascade can leave partially-shifted `date_label`s; structure (`ordre`/`semaine_num`) self-heals on the next operation via the idempotent resequence pass; individual rows remain editable in the panel to correct dates. No transaction/migration.

---

### Task 1: Pure helpers in `src/lib/calendar.ts`

**Files:**
- Modify: `src/lib/calendar.ts`
- Test: `src/lib/__tests__/calendar.test.ts` (append)

**Interfaces:**
- Consumes: existing `RowSeed`, `monthLabel`, private `fmt`
- Produces (all exported, pure, no DB, no crypto — actions inject identity):
  - `renumberRows<T extends { ordre: number }>(rows: T[]): T[]`
  - `resequenceWeeks<T extends RowSeed>(rows: T[]): T[]`
  - `shiftDateLabel(label: string, deltaDays: number): string`
  - `nextMondayAfter(d: Date): Date` (strictly after)
  - `mondayOfWeek(d: Date): Date`
  - `EditRow` type = `RowSeed & { id: string; row_uuid: string }` (DB-shaped row)
  - `computeInsertWeek(after: EditRow | null, first: EditRow | null): { dateStart: Date; dateEnd: Date }` — dates for a new week (next Monday after `after.end`, else `first.start − 7`)
  - `computeInsertEventDate(anchor: EditRow | null): Date` — mondayOfWeek(anchor.start)
  - `applyInsertWeek<T extends EditRow>(rows: T[], afterId: string | null, newRow: T): T[]` — splices `newRow` after `afterId` (head when null), shifts all subsequent rows +7, recomputes `mois` on shifted enseignement rows, renumbers + resequences
  - `applyDeleteRow<T extends EditRow>(rows: T[], rowId: string): T[]` — removes row; **if it was `enseignement`, shifts all later rows −7** (else no shift); renumbers + resequences
  - `applyShift<T extends EditRow>(rows: T[], rowId: string, deltaDays: number): T[]` — cascade shift from that row onward, recompute `mois`
  - `applyManualDates<T extends EditRow>(rows: T[], rowId: string, dateStart: Date, dateEnd: Date): T[] | { error: string }` — sets that row's `date_label` + `mois` only; error when `dateStart > dateEnd`
- Note: `RowSeed` itself is unchanged (seeds don't carry identity); `EditRow` is the DB shape used by edit paths.

- [ ] **Step 1: Write failing tests** (append to `src/lib/__tests__/calendar.test.ts`; vitest `describe/it/expect`)

```ts
import {
  applyDeleteRow, applyInsertWeek, applyManualDates, applyShift,
  computeInsertEventDate, computeInsertWeek, mondayOfWeek,
  nextMondayAfter, renumberRows, resequenceWeeks, shiftDateLabel,
  type EditRow,
} from "../calendar";

// Sept 7 2026 IS a Monday. Helpers under test are pure; ids are opaque strings.
function week(id: string, num: number, label: string, mois = "Septembre"): EditRow {
  return {
    id, row_uuid: "ru-" + id, row_type: "enseignement", ordre: 0, mois,
    semaine_num: num, date_label: label, periode_label: null, evenement_label: null,
  };
}
function event(id: string, label: string, type: string, dates: string): EditRow {
  return {
    id, row_uuid: "ru-" + id, row_type: "evenement", ordre: 0, mois: null,
    semaine_num: null, date_label: dates, periode_label: label, evenement_label: type,
  };
}

describe("calendar editing helpers", () => {
  it("renumberRows reindexes ordre", () => {
    const rows = [week("a", 5, "07/09/2026 → 11/09/2026"), week("b", 9, "14/09/2026 → 18/09/2026")];
    expect(renumberRows(rows).map((r) => r.ordre)).toEqual([1, 2]);
  });

  it("resequenceWeeks renumbers weeks 1..n, events stay null", () => {
    const rows = [week("a", 5, "07/09/2026 → 11/09/2026"), event("e", "T", "evaluation", "07/09/2026 → 07/09/2026"), week("b", 9, "14/09/2026 → 18/09/2026")];
    const out = resequenceWeeks(renumberRows(rows));
    expect(out.map((r) => r.ordre)).toEqual([1, 2, 3]);
    expect(out.map((r) => r.semaine_num)).toEqual([1, null, 2]);
  });

  it("nextMondayAfter: Fri+3 and Mon+7", () => {
    expect(nextMondayAfter(new Date(2026, 8, 11)).getTime()).toBe(new Date(2026, 8, 14).getTime()); // Fri 11/09 → Mon 14/09
    expect(nextMondayAfter(new Date(2026, 8, 7)).getTime()).toBe(new Date(2026, 8, 14).getTime());  // Mon 07/09 → Mon 14/09
  });

  it("mondayOfWeek lands on the same week's Monday", () => {
    expect(mondayOfWeek(new Date(2026, 8, 9)).getTime()).toBe(new Date(2026, 8, 7).getTime());
  });

  it("applyInsertWeek: cascade +7, renumber, resequence", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026"), week("c", 3, "21/09/2026 → 25/09/2026")];
    const { dateStart, dateEnd } = computeInsertWeek(rows.find((r) => r.id === "a")!, null);
    expect(dateStart.getTime()).toBe(new Date(2026, 8, 14).getTime());
    const nw: EditRow = { ...week("new", 0, "14/09/2026 → 18/09/2026"), semaine_num: 0 };
    const out = applyInsertWeek(rows, "a", nw);
    expect(out.map((r) => r.id)).toEqual(["a", "new", "b", "c"]);
    expect(out.map((r) => r.date_label)).toEqual([
      "07/09/2026 → 11/09/2026",
      "14/09/2026 → 18/09/2026",
      "21/09/2026 → 25/09/2026",
      "28/09/2026 → 02/10/2026",
    ]);
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2, 3, 4]);
    expect(out[3].mois).toBe("Septembre"); // mois follows the START date (28/09)
  });

  it("applyInsertWeek at head: new week = first.start − 7, existing rows untouched", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026")];
    const { dateStart } = computeInsertWeek(null, rows[0]);
    expect(dateStart.getTime()).toBe(new Date(2026, 7, 31).getTime()); // 31/08/2026
    const out = applyInsertWeek(rows, null, week("new", 0, "31/08/2026 → 04/09/2026"));
    expect(out.map((r) => r.id)).toEqual(["new", "a"]);
    expect(out[0].date_label).toBe("31/08/2026 → 04/09/2026");
    expect(out[1].date_label).toBe("07/09/2026 → 11/09/2026"); // a does NOT move
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2]);
  });

  it("applyInsertWeek after an event anchor uses next Monday strictly after; cascade hits only rows after the new week", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), event("e", "Rentrée", "detente", "07/09/2026 → 07/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const { dateStart } = computeInsertWeek(rows.find((r) => r.id === "e")!, null);
    expect(dateStart.getTime()).toBe(new Date(2026, 8, 14).getTime()); // Mon 07/09 → next Mon 14/09
    const out = applyInsertWeek(rows, "e", week("new", 0, "14/09/2026 → 18/09/2026"));
    expect(out.map((r) => r.id)).toEqual(["a", "e", "new", "b"]);
    expect(out[2].date_label).toBe("14/09/2026 → 18/09/2026"); // new week keeps its slot
    expect(out[3].date_label).toBe("21/09/2026 → 25/09/2026"); // b shifted +7
    expect(out.map((r) => r.semaine_num)).toEqual([1, null, 2, 3]);
  });

  it("applyDeleteRow of a week closes the gap (−7 on later rows)", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026"), week("c", 3, "21/09/2026 → 25/09/2026")];
    const out = applyDeleteRow(rows, "b");
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
    expect(out[1].date_label).toBe("14/09/2026 → 18/09/2026");
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2]);
  });

  it("applyDeleteRow of an event leaves dates untouched", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), event("e", "T", "evaluation", "14/09/2026 → 14/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const out = applyDeleteRow(rows, "e");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[1].date_label).toBe("14/09/2026 → 18/09/2026");
  });

  it("applyShift cascades and recomputes mois across year boundary", () => {
    const rows = [week("a", 1, "28/12/2026 → 01/01/2027", "Décembre"), week("b", 2, "04/01/2027 → 08/01/2027", "Janvier")];
    const out = applyShift(rows, "a", 7);
    expect(out[0].date_label).toBe("04/01/2027 → 08/01/2027");
    expect(out[0].mois).toBe("Janvier");
    expect(out[1].date_label).toBe("11/01/2027 → 15/01/2027");
  });

  it("computeInsertEventDate is the anchor week's Monday (single day)", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026")];
    const d = computeInsertEventDate(rows[0]);
    expect(d.getTime()).toBe(new Date(2026, 8, 7).getTime());
  });

  it("applyManualDates touches only that row, validates order, recomputes mois", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const ok = applyManualDates(rows, "b", new Date(2026, 8, 28), new Date(2026, 9, 2));
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok[1].date_label).toBe("28/09/2026 → 02/10/2026");
      expect(ok[1].mois).toBe("Septembre");
      expect(ok[0].date_label).toBe("07/09/2026 → 11/09/2026");
    }
    const bad = applyManualDates(rows, "b", new Date(2026, 9, 5), new Date(2026, 9, 2));
    expect("error" in bad).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test`. Expected: FAIL (imports missing).

- [ ] **Step 3: Implement the helpers** in `src/lib/calendar.ts`

```ts
export type EditRow = RowSeed & { id: string; row_uuid: string };

const LABEL_DATE_RE = /\d{2}\/\d{2}\/\d{4}/g;

function parseFrDate(s: string): Date {
  const [dd, mm, yyyy] = s.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/** Shift every DD/MM/YYYY found in a date_label by deltaDays. */
export function shiftDateLabel(label: string, deltaDays: number): string {
  return label.replace(LABEL_DATE_RE, (m) => {
    const d = parseFrDate(m);
    d.setDate(d.getDate() + deltaDays);
    return fmt(d);
  });
}

/** Next Monday strictly after d. */
export function nextMondayAfter(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + (((8 - out.getDay()) % 7) || 7));
  return out;
}

/** Monday of d's week. */
export function mondayOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function parseLabelBounds(label: string | null): { start?: Date; end?: Date } {
  const m = label?.match(LABEL_DATE_RE);
  return m && m.length === 2 ? { start: parseFrDate(m[0]), end: parseFrDate(m[1]) } : {};
}

/** Recompute mois from start for enseignement rows; events stay null. */
function withMois<T extends RowSeed>(row: T): T {
  if (row.row_type !== "enseignement") return { ...row, mois: null };
  const { start } = parseLabelBounds(row.date_label);
  return start ? { ...row, mois: monthLabel(start) } : row;
}

/** Cascade-shift rows at/after index `from` by deltaDays (dates + mois), then renumber/resequence. */
function shiftFrom<T extends EditRow>(rows: T[], from: number, deltaDays: number): T[] {
  const out = rows.map((r, i) => {
    if (i < from) return r;
    return withMois({ ...r, date_label: r.date_label ? shiftDateLabel(r.date_label, deltaDays) : r.date_label });
  });
  return resequenceWeeks(renumberRows(out));
}

export function computeInsertWeek(after: EditRow | null, first: EditRow | null): { dateStart: Date; dateEnd: Date } {
  if (after) {
    const { end } = parseLabelBounds(after.date_label);
    if (end) {
      const dateStart = nextMondayAfter(end);
      return { dateStart, dateEnd: addDays(dateStart, 4) };
    }
  }
  const f = first;
  const { start } = f ? parseLabelBounds(f.date_label) : {};
  if (!start) throw new Error("Anchor de dates introuvable");
  const dateStart = addDays(start, -7);
  return { dateStart, dateEnd: addDays(dateStart, 4) };
}

export function computeInsertEventDate(anchor: EditRow | null): Date {
  const { start } = (anchor && parseLabelBounds(anchor.date_label)) || {};
  if (!start) throw new Error("Anchor de dates introuvable");
  return mondayOfWeek(start);
}

export function applyInsertWeek<T extends EditRow>(rows: T[], afterId: string | null, newRow: T): T[] {
  const at = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : 0;
  const out = [...rows.slice(0, at), { ...newRow, ordre: 0, semaine_num: 0 }, ...rows.slice(at)];
  // Anchored insert takes the anchor's successor slot → shift everything AFTER the new row +7
  // (the new row keeps the dates it was computed with). Head insert fills the empty space
  // before the first row → no shift (calendar extends earlier, still continuous).
  return afterId
    ? shiftFrom(out, at + 1, 7)
    : resequenceWeeks(renumberRows(out));
}

export function applyDeleteRow<T extends EditRow>(rows: T[], rowId: string): T[] {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return rows;
  const wasTeaching = rows[idx].row_type === "enseignement";
  const out = rows.filter((r) => r.id !== rowId);
  return wasTeaching ? shiftFrom(out, idx, -7) : resequenceWeeks(renumberRows(out));
}

export function applyShift<T extends EditRow>(rows: T[], rowId: string, deltaDays: number): T[] {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return rows;
  return shiftFrom(rows, idx, deltaDays);
}

export function applyManualDates<T extends EditRow>(
  rows: T[], rowId: string, dateStart: Date, dateEnd: Date
): T[] | { error: string } {
  if (dateStart > dateEnd) return { error: "La date de début doit précéder la date de fin." };
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return { error: "Ligne introuvable." };
  const out = [...rows];
  out[idx] = withMois({ ...out[idx], date_label: `${fmt(dateStart)} → ${fmt(dateEnd)}` });
  return out;
}
```

- [ ] **Step 4: Run tests** — `npm test`. Expected: all pass (existing + new). Fix the inline "mois follows START" comment confusion in the first insert test if needed: `out[3]` starts 28/09 → `mois` stays `"Septembre"`; assert `out[3].mois === "Septembre"`.
- [ ] **Step 5: Stop for commit approval** (never auto-commit).

### Task 2: Server actions in `src/app/(app)/admin/calendrier/actions.ts`

**Files:**
- Modify: `actions.ts`

**Interfaces:**
- Extend `updateTemplateRow` patch to `{ row_type?; periode_label?; date_label?; evenement_label?; mois? }` (no `semaine_num` — never manually set; resequence owns it). When `date_label` is in the patch, the action recomputes `mois` server-side from the new start (don't trust the client).
- New exported actions (all `Promise<Result>`; all call `requireCalendarAdmin()`):
  - `deleteTemplateRow({ templateVersionId, rowId })`
  - `insertTemplateWeek({ templateVersionId, afterRowId })` → `{ id?: string }` on success (returns the new DB `id` so the UI can select it)
  - `insertTemplateEvent({ templateVersionId, afterRowId, label, type })` → `{ id?: string }`
  - `shiftTemplateWeek({ templateVersionId, rowId, deltaDays })`
- Shared internal `resequenceVersionRows(supabase, templateVersionId)`: select rows ordered by `ordre` → `renumberRows` + `resequenceWeeks` → per-row `update().eq("id", r.id)` **only when** `ordre`/`semaine_num`/`mois` differ from DB values. Idempotent: a no-op when state is already consistent (self-heal path).
- Insert flow: select version rows → `computeInsertWeek`/`computeInsertEventDate` → build DB row `{ template_version_id, row_uuid: crypto.randomUUID(), ordre: 0, ... }` → insert → `applyInsertWeek`/`applyDeleteRow` locally on the fetched rows (with the inserted row standing in with its DB `id`) → resequence writes → `revalidatePath("/admin/calendrier")`.
- Delete flow: select rows → `applyDeleteRow` locally → DB delete by `id` → write shifted `date_label`/`mois` for changed rows → resequence → revalidate.
- Shift flow: select rows → `applyShift` locally → update every row whose `date_label`/`mois` changed → resequence → revalidate.
- Every action re-fetches rows fresh inside the action (no trusting client row data beyond `rowId`/`deltaDays`).

- [ ] **Step 1: Extend `updateTemplateRow`** (patch type + server-side `mois` recompute on `date_label` patches)
- [ ] **Step 2: Implement `resequenceVersionRows`** (internal, idempotent, diff-based)
- [ ] **Step 3: Implement delete / insert-week / insert-event / shift** per flows above
- [ ] **Step 4: Gates** — `npx tsc --noEmit` clean; `npm test` green

### Task 3: Side-panel editing UI in `src/components/calendar/calendar-manager.tsx`

**Files:**
- Modify: `calendar-manager.tsx`; if the page doesn't already pass it, thread `activeTemplateVersionId` from `page.tsx` into `CalendarManager` as an explicit prop (page loads the active version server-side — do not re-derive client-side).

**Interfaces:**
- Consumes: Task 2 actions; existing `selected` Row state; `router.refresh()`.
- Produces: panel is an edit form keyed by `selected.id` (state resets on selection change). Per row type (French strings):
  - **enseignement**: Dates (two `<Input type="date">`, initialized from parsed `date_label`), `periode_label` (text), actions: `− 1 j` / `+ 1 j` (hint text: "décale toutes les lignes suivantes"), `Insérer une semaine`, `Insérer un événement`, `Supprimer`, `Enregistrer`
  - **evenement**: `periode_label` (text), type `<Select>` (evaluation/examen/revision/vacances/detente — same set as generation), Dates (two date inputs), same actions
- Wiring:
  - `Enregistrer` → validate start ≤ end client-side (inline French error, no call on failure) → `updateTemplateRow` (patch `date_label` merged from the two inputs) → refresh
  - `±1 j` → `shiftTemplateWeek` → refresh (selection preserved: same `id` still exists)
  - `Insérer une semaine` → `insertTemplateWeek({ afterRowId: selected.id })` → refresh → clear selection (the new row is visible in the grid; selecting it is one click)
  - `Insérer un événement` → small inline prompt for label + type (default "Évaluation"/"evaluation") → `insertTemplateEvent` → refresh → clear selection
  - `Supprimer` → `confirm(...)` French → `deleteTemplateRow` → refresh → **`setSelected(null)`** (no stale panel)
  - Busy flag disables buttons; errors render inline under the form
- Page guard already verified (super admin redirect); section admins never reach this UI.

- [ ] **Step 1: Edit form** (fields per row type, keyed reset, inline validation)
- [ ] **Step 2: Action wiring** (save/shift/insert/delete → action → refresh/selection rules, busy + error display)
- [ ] **Step 3: Gates** — typecheck, `npm test`, eslint with no NEW findings vs HEAD baseline

### Task 4: Verification & docs

- [ ] **Step 1: Browser-verify with super-admin account** (temp Puppeteer script under `scripts/`, deleted after use):
  - Click a week → editable panel; change a period label → save → persists after reload
  - Insert week mid-calendar → later weeks +7, numbering resequenced, no collisions in the grid
  - Delete that week → later weeks −7, back to original layout
  - Insert event → single-day Monday band; widen it in the panel; delete it → weeks untouched
  - Shift S2 +1 j → S2 and all later rows move; month-boundary row recomputes `mois`
  - Manual edit with end < start → inline error, nothing saved
- [ ] **Step 2: Fiches-untouched proof** — snapshot one existing fiche's `fiche_rows` (`row_uuid`, `ordre`, `semaine_num`, `date_label` + `fiche_cells` count) before edits, compare after edits: **byte-identical**. Then create a NEW attribution → its rows reflect the edited calendar.
- [ ] **Step 3: Update `docs/TESTING.md`** with the calendar-editing walkthrough.
- [ ] **Step 4: Full gates** — typecheck, `npm test`, lint baseline unchanged. **NO commit — remind the user to approve.**

## Self-Review

- Spec coverage: fine edits (dates/labels/shift/insert/delete) ✓; fiches untouched (snapshot table + verified no FKs; Task 4 proves it) ✓; side-panel editing ✓; themes already handled (frame uses `var(--primary)`, verified amber/blue per section) ✓; no reorder buttons (decision #4) ✓; sequential-writes atomicity choice (decision #5) documented with its limitation ✓.
- Placeholder scan: no TBDs; every helper and test fully specified.
- Type consistency: `EditRow = RowSeed & { id; row_uuid }` used uniformly; UI/actions use `id`, helpers key on `id` too after the action maps fetched DB rows (both fields present on `EditRow`; the plan's helper signatures index by `id` — `row_uuid` is carried for inserts only).
- Resolved-review-items: identity contract ✓ (Verified schema facts), FK safety ✓, insert/delete date semantics ✓ (decisions #1–#2), no reorder ✓ (#4), mois recompute ✓, validation + cascade semantics ✓, guards verified ✓, version-ID threading explicit ✓, stale-selection ✓, fiche verification strengthened (content, not count) ✓.
