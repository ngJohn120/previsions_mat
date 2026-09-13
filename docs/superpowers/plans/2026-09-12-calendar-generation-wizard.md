# Calendar Generation Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Générer le calendrier" modal with a dedicated 4-step wizard page reusing the existing `generateCalendar` action unchanged.

**Architecture:** New route `src/app/(app)/admin/calendrier/generer/page.tsx` (server: guard + year resolution) rendering a new client component `src/components/calendar/generation-wizard.tsx` (steps, events editor, client preview via pure `buildWeeks`); parent page button repointed; modal code deleted from `calendar-manager.tsx`.

**Tech Stack:** Next.js App Router + server actions, Supabase, TypeScript, Tailwind/shadcn (`Button`, `Input`, `Label`, `Dialog` removal only), `npx tsc --noEmit`, `npm test`, `npx eslint <files>`, psql via `podman exec supabase_db_Prevision_WebApp psql -U postgres -d postgres`.

## Global Constraints

- Dev server runs on port 3001; port 3000 belongs to the Hermes bridge — never use it.
- French only for UI strings; docs/discussion in English.
- Super admin only (same guard as the parent calendrier page).
- No commits until the whole feature is implemented AND the user approves (per-task "commit" steps are replaced by checkpoint reviews).
- No `any` in new code (`@typescript-eslint/no-explicit-any` is an error).
- Temp browser verify scripts go in `scripts/` and are deleted after verification.
- Never read/print/commit secrets; `.env*` files are off-limits.
- Binding mockup: `docs/mockups/17-generation-assistant.html` — match its copy and step order; do not invent new labels.

---

### Task 1: Route + page shell + stepper skeleton

**Files:**
- Create: `src/app/(app)/admin/calendrier/generer/page.tsx`
- Test: browser load as super admin (Task 5)

**Interfaces:**
- Consumes: `getSessionUser`, `isSuperAdmin` from `@/lib/auth`; `createClient` from `@/lib/supabase/server`; `cookies` from `next/headers`.
- Produces: renders `<GenerationWizard yearId, yearLabel, section, activeVersion, sectionLabel />` (props consumed by Task 2–3 — exact names, do not rename).

- [ ] **Step 1: Create the page** — guard (`if (!user) redirect("/login"); if (!isSuperAdmin(user.roles)) redirect("/")`), section from `searchParams` (`section === "secondaire" ? "secondaire" : "primaire"`), year from the `pm_year` cookie with active-year fallback (copy the block at `calendrier/page.tsx:26-38` verbatim), active version lookup for (yearId, sectionKey) to pass `activeVersion: number | null`:

```tsx
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GenerationWizard } from "@/components/calendar/generation-wizard";

export const dynamic = "force-dynamic";

const YEAR_COOKIE = "pm_year";

export default async function GenererCalendrierPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isSuperAdmin(user.roles)) redirect("/");

  const { section } = await searchParams;
  const sectionKey = section === "secondaire" ? "secondaire" : "primaire";

  const supabase = await createClient();
  const cookieStore = await cookies();
  const cookieYear = cookieStore.get(YEAR_COOKIE)?.value;

  const { data: years } = await supabase
    .from("school_years")
    .select("id, label, status, start_date, end_date");

  const selectedYear = (years ?? []).find((y: { id: string }) => y.id === cookieYear)
    ?? (years ?? []).find((y: { status: string }) => y.status === "active")
    ?? (years ?? [])[0];

  let activeVersion: number | null = null;
  if (selectedYear) {
    const { data: tv } = await supabase
      .from("template_versions")
      .select("version")
      .eq("school_year_id", selectedYear.id)
      .eq("section", sectionKey)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeVersion = tv?.version ?? null;
  }

  if (!selectedYear) redirect("/admin/calendrier");

  return (
    <GenerationWizard
      yearId={selectedYear.id}
      yearLabel={selectedYear.label}
      yearStart={selectedYear.start_date}
      yearEnd={selectedYear.end_date}
      section={sectionKey}
      activeVersion={activeVersion}
    />
  );
}
```

- [ ] **Step 2: Create the skeleton `src/components/calendar/generation-wizard.tsx`** — `"use client"`, props typed exactly as above (`section: "primaire" | "secondaire"`, rest strings/number|null), `useState` step (1–4), stepper header + four placeholder panels with Back/Continue buttons wiring `setStep` only. No fields yet.
- [ ] **Step 3: Typecheck** — Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/dev"`. Expected: no output lines.
- [ ] **Step 4: Checkpoint review** — route loads (compile check via `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/admin/calendrier/generer` → 200/307). Do not commit.

---

### Task 2: Steps 1–2 (params + structured events editor)

**Files:**
- Modify: `src/components/calendar/generation-wizard.tsx`
- Test: browser interaction (Task 5)

**Interfaces:**
- Produces: state shape consumed by Task 3 — `params: { section, startDate, endDate }` and `events: { id: string; label: string; type: EventType; start: string; end: string }[]` where `type EventType = "vacances" | "évaluation" | "examen" | "révision" | "détente"`.

- [ ] **Step 1: Step 1 panel** — read-only year label; section `<select>` (primaire/secondaire, local state initialized from prop — changing it only affects the payload, it does not navigate); Rentrée + Fin `<Input type="date">` initialized from `yearStart`/`yearEnd`; active-version info banner when `activeVersion !== null` (« …v{activeVersion} … v{activeVersion + 1} en brouillon… »). Continue validates: both dates present and start ≤ end, else inline red error, no advance.
- [ ] **Step 2: Events editor** — rows with Libellé `<Input>`, Type `<select>` (the 5 fixed types), Début/Fin date inputs, delete button; `+ Ajouter un événement` appends `{ id: crypto.randomUUID(), label: "", type: "vacances", start: "", end: "" }`. Continue validates every row (libellé non-empty, dates present, début ≤ fin, range within [startDate, endDate]) with a row-indexed inline error; state preserved on Back.
- [ ] **Step 3: Typecheck** — same `tsc` command. Expected: clean.
- [ ] **Step 4: Checkpoint review.**

---

### Task 3: Step 3 preview + Step 4 confirm/generate

**Files:**
- Modify: `src/components/calendar/generation-wizard.tsx`
- Consumes: `buildWeeks` from `@/lib/calendar` (pure, client-safe); `generateCalendar` from `@/app/(app)/admin/calendrier/actions`; `useRouter` from `next/navigation`.

**Interfaces:** No signature changes to the action. Payload: `{ yearId, section, startDate, endDate, events: events.map(({label, type, start, end}) => ({label, type, start, end})) }` — ISO dates, already supported by the action's parser.

- [ ] **Step 1: Preview panel** — `useMemo(() => buildWeeks(new Date(startDate), new Date(endDate)), [startDate, endDate])`; headline `N semaines · M jours de cours (lun–ven) · K événements` (jours = weeks × 5); scrollable condensed week list (`S01 · 01/09/2026 → 05/09/2026` rows, ellipsis markers for runs longer than 3 plain weeks, exactly like the mockup); event bands by checking each week's [start,end] overlap with each event range, band classes reuse the editor's event-type colors; `← Modifier les événements` returns to step 2.
- [ ] **Step 2: Confirm + submit** — summary line (section label · year label · N semaines + K événements · `v{(activeVersion ?? 0) + 1} brouillon`); `Générer le calendrier` with the hardened submit (the attributions-hang lesson — try/catch, never a stuck spinner):

```tsx
async function submitGenerate() {
  setBusy(true); setError(null);
  try {
    const res = await generateCalendar({
      yearId, section: params.section, startDate: params.startDate, endDate: params.endDate,
      events: events.map((e) => ({ label: e.label.trim(), type: e.type, start: e.start, end: e.end })),
    });
    if (res.error) { setError(res.error); setBusy(false); return; }
  } catch {
    setError("La requête n'a pas abouti. Vérifiez si le calendrier a été généré, puis réessayez.");
    setBusy(false); return;
  }
  setBusy(false);
  router.push(`/admin/calendrier?section=${params.section}`);
  router.refresh();
}
```

- [ ] **Step 3: Typecheck** — same `tsc` command. Expected: clean.
- [ ] **Step 4: Checkpoint review.**

---

### Task 4: Repoint parent page, delete the modal

**Files:**
- Modify: `src/components/calendar/calendar-manager.tsx` (header button ~line 413 + dialog block ~lines 512-542 + now-unused `genOpen`/`genForm`/`submitGenerate` state)
- Test: parent page still compiles and links correctly (Task 5)

- [ ] **Step 1: Replace the button** — `<Button onClick={() => setGenOpen(true)}>…Générer le calendrier</Button>` becomes a link preserving section:

```tsx
<Button onClick={() => router.push(`/admin/calendrier/generer?section=${section}`)}><span className="mr-1">+</span> Générer le calendrier</Button>
```

(`router` is already imported and used in this file.)
- [ ] **Step 2: Delete the dialog** — remove the `{/* Generate dialog */}` `<Dialog>` block, the `genOpen`/`setGenOpen` and `genForm`/`setGenForm` state, and `submitGenerate`. Remove `generateCalendar` from the actions import if unused elsewhere in the file (check first — do not leave an unused import; do not remove it if still referenced).
- [ ] **Step 3: Typecheck + lint** — Run: `npx tsc --noEmit 2>&1 | grep -v "\.next/dev"` (clean) and `npx eslint "src/components/calendar/calendar-manager.tsx" "src/components/calendar/generation-wizard.tsx" "src/app/(app)/admin/calendrier/generer/page.tsx"` (zero new warnings).
- [ ] **Step 4: Checkpoint review.**

---

### Task 5: Full verification

- [ ] **Step 1: Static gates** — `npx tsc --noEmit` clean; `npm test` green; eslint on all Task 1–4 files with zero new warnings.
- [ ] **Step 2: Guard check** — non-super-admin (admin.prim) visiting `/admin/calendrier/generer` lands on `/` (route guard works).
- [ ] **Step 3: Browser happy path** (temp `scripts/verify-gen-*.mjs`, delete afterwards; super admin `direction@siloe.edu` / `Test1234!`; port 3001): params → add 2nd event row → preview counts match `buildWeeks` math → generate → parent page shows the new version ACTIVE and the previous one demoted (immediate activation — same as the old modal). Restore afterwards: delete the test version (+ cascaded rows) via SQL and reactivate the previous version.
- [ ] **Step 4: Validation paths** — bad dates, incomplete event row, out-of-range event each render inline French errors; Continue blocked.
- [ ] **Step 5: Report results; await user approval for the final commit.** Do not commit.

---

## Self-Review

1. **Spec coverage:** §4→Task 1 (+ guard check Task 5 Step 2); §5.1→Task 2 Step 1; §5.2→Task 2 Step 2; §5.3→Task 3 Step 1; §5.4→Task 3 Step 2; §5.5→no task (correct — reuse only); §6→Task 5 Steps 3–4 + `busy` guard in the submit code; §7→Task 5.
2. **Placeholder scan:** all steps carry concrete code/commands/paths; no TBD/TODO/generic validation language.
3. **Type consistency:** `GenerationWizard` props (`yearId, yearLabel, yearStart, yearEnd, section, activeVersion`) identical in Task 1 producer and Task 2–3 consumer; `EventType` union matches the 5 app event types; action payload matches `generateCalendar`'s existing input type.
