# TESTING.md — Prévisions Matières (SILOE)

Manual end-to-end test script for the local app.

## Prerequisites

- Dev server running on **port 3001** (port 3000 is permanently reserved for the Hermes WhatsApp bridge — never use it for this app):
  ```bash
  npm run dev          # → http://localhost:3001
  ```
  For phone/tablet access on the same Wi-Fi, open `http://<PC-LAN-IP>:3001` (e.g. `192.168.11.102`). `next.config.ts` auto-allows the machine's LAN IPv4 addresses in `allowedDevOrigins` so dev resources (HMR, fonts, CSS) load over LAN — restart the dev server after changing the config or the PC's IP. The helper scripts default to `http://localhost:3001`; override with `BASE_URL` or edit the `BASE` constant at the top of each script if you run on another port.
- Linked Supabase dev project with migrations `0001`–`0009` applied.
- Demo data (optional but recommended):
  ```bash
  node scripts/seed-demo.mjs        # classes, branches, templates, 2 fiches
  node scripts/make-pdf-samples.mjs # optional PDF samples in docs/out/
  ```

## Test accounts (all password `Test1234!`)

| Email | Rôle | Scope |
|---|---|---|
| `direction@siloe.edu` | Super admin | all sections |
| `admin.prim@siloe.edu` | Admin Primaire + Enseignant | primaire |
| `admin.sec@siloe.edu` | Admin Secondaire + Enseignant | secondaire |
| `m.mbuyi@siloe.edu` | Enseignant | primaire (6e B – Français) |
| `m.kazadi@siloe.edu` | Enseignant | secondaire (3e – Mathématiques) |

## Walkthrough

### 1. Login / shell
- [ ] Open `http://localhost:3001/login`, sign in as `m.mbuyi@siloe.edu`.
- [ ] Topbar shows: logo, **Mes fiches** nav, year 2026–2027, bell, avatar.
- [ ] PWA: Chrome DevTools → Application → Service Workers → `sw.js` registered; manifest loads at `/manifest.webmanifest`.

### 2. Teacher dashboard (`/enseignant`)
- [ ] Stat cards (total / brouillons / soumises / à compléter), progression bars.
- [ ] Row for « Français · 6e B » shows progression > 0 (seeded 3 weeks filled).
- [ ] Click « Ouvrir » → editor opens.

### 3. Editor (primary) — `/fiche/[id]`
- [ ] Document header (SILOE + année), grid grouped by month, columns Mois | Semaine | Matières | Réf. | Intention | Obs.
- [ ] Event bands visible (1re évaluation, Vacances de Noël…).
- [ ] Edit a cell → debounce → « Enregistré » tick; reload page → value persisted.
- [ ] Completeness bar increments; « Soumettre » stays disabled until 100 %.
- [ ] Fill all required cells (helper: seed fills 3 — fill remaining via SQL or UI) → submit → status chip « Soumise », editor read-only.
- [ ] « Aperçu impression » → new tab `/impression/[id]` with 2 A4-landscape sheets + BROUILLON watermark; « Télécharger le PDF » downloads a valid PDF.

### 4. Unlock workflow
- [ ] From dashboard on a *soumise* fiche, « Demander modification » → motif → submit.
- [ ] Sign in as section admin (`admin.prim@siloe.edu` for primary) → **Suivi** shows the demande; open consultation page shows Approuver / Refuser.
- [ ] Approve → fiche back to brouillon; teacher gets a notification (bell count).

### 5. Offline / sync (primary editor)

> **Prerequisite for the reload steps below:** keep the fiche open in the same tab/profile and load it **online at least once first** so the service worker (`sw.js`) is installed and controlling that origin. Use `http://localhost:3001` consistently — the SW is origin-scoped, so switching between `localhost:3001` and `127.0.0.1:3001` (or another port) acts like a fresh origin with no SW. If you get « This site can't be reached » on a reload, you are on an origin/tab that has no active service worker yet — go back online, load `/fiche/[id]` once, then repeat the offline steps.

- [ ] DevTools → Network → Offline. Edit a cell → banner « Hors ligne… », toolbar pill shows offline.
- [ ] Reload (still offline) → content loads from IndexedDB (auto-resume), edits persist.
- [ ] Go back online → outbox drains; server value matches.

### 6. Conflict resolution
- [ ] With two tabs/devices editing the same cell while one is offline → after reconnect, editor shows the A/B/C resolver; pick a version → conflict clears.

### 7. Admin suivi (`/admin/suivi`)
- [ ] Stat cards + tabs (Toutes / Soumissions / Demandes / Conflits); search filters.
- [ ] « Consulter » opens read-only fiche.
- [ ] « Exporter (CSV) » downloads a CSV of fiches.

### 8. Notifications (`/notifications`)
- [ ] Bell shows unread count; list maps types with icon + action link; « Tout marquer comme lu » works.

### 9. Structure / admin pages (Phase 2)
- [ ] `/admin/branches`, `/primaire/structure`, `/admin/calendrier`, `/admin/annee`, `/admin/utilisateurs` render with seeded data.

### 9b. Calendar editing (`/admin/calendrier`, super admin only)
- [ ] Click a week chip → side panel shows an **editable** form (Début/Fin dates, Période; events also get a Type select).
- [ ] `Enregistrer` with unchanged fields → no error; reload → values persist.
- [ ] Manual dates with end < start → inline error « La date de début doit précéder la date de fin. », nothing saved.
- [ ] `+ 1 j` on a week → that week and **all later rows** shift +1 day (S1 untouched); `− 1 j` restores.
- [ ] `Insérer une semaine` → new week in the anchor's successor slot; later weeks shift +7; numbering resequenced (no S0, no date collisions).
- [ ] Delete that inserted week → later weeks shift −7; original layout restored.
- [ ] `Insérer un événement` → single-day event on the anchor week's Monday; no cascade; label/type editable; delete removes it without touching weeks.
- [ ] Existing teacher fiches are untouched by any of the above (edits only affect `template_rows`; new attributions pick up the edited calendar).
- [ ] Known generation-dialog gotcha: event dates must be `DD/MM/YYYY` (e.g. `23/12/2026`), not ISO — the parser is DD/MM-only.

### 10. CSV import
- [ ] **Users**: on `/admin/utilisateurs` « Importer (CSV) » → template download → fill a row (new email) → import → user appears.
- [ ] **Classes**: `/primaire/structure` importer creates a class with titulaire by email.
- [ ] **Branches**: `/admin/branches` importer creates branch + sous-branches.
- [ ] **Attributions**: `/secondaire/attributions` importer creates an attribution → draft fiche auto-created.

## Checks

```bash
npx vitest run      # unit tests (calendar, sync engine, outbox, csv)
npx tsc --noEmit    # typecheck
npm run build       # production build (all routes listed)
```

## Troubleshooting

- **PDF 500**: ensure Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe` (or set `CHROME_PATH`); route needs auth cookie.
- **Migration push hangs**: known Supabase CLI pg-delta catalog timeout noise; re-run `supabase db push --linked`.
- **Port 3000 is the Hermes WhatsApp bridge — never run this app there.** `npm run dev` is pinned to **3001**. If a stray `next dev` grabs 3000 (it shows up as `start-server.js` with `Dir: ...Prevision_WebApp`), kill that PID — the bridge owns 3000. Scripts in `scripts/` default to `http://localhost:3001` at the top (`BASE`) — override with `BASE_URL` if you run elsewhere.
