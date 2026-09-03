# TESTING.md — Prévisions Matières (SILOE)

Manual end-to-end test script for the local app.

## Prerequisites

- Dev server: `npm run dev -- -p 3001` (LAN: prefix with `LOCAL_LAN_HOST`).
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
- [ ] Topbar shows: logo, **Mes fiches / Notifications** nav, year 2026–2027, bell, avatar.
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
- **Port 3000 conflict**: it's the Hermes WhatsApp bridge — always dev on **3001**.
