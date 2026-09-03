# Prévisions Matières — Design Specification (v1)

**Date:** 2026-09-02
**Status:** Approved in sections (Parts 1–4) + teacher-journey mockups approved (batch 1)
**Repo:** ngJohn120/previsions_mat (local: `C:\Users\Administrator\Documents\MEGA\Documents\SILOE\Prevision_WebApp`)
**Docs in English; UI strings + generated documents in French.**

---

## 1. Product summary

A web platform for **Complexe Scolaire SILOE** (Lubumbashi, DRC) to record, per school year, the **content to be taught** across all subjects of the **primary and secondary** sections. Each subject has a **single annual form (fiche)** covering the whole year's material. Teachers fill and submit fiches; administrators supervise. The paper forms (see `WorkToDo.txt` references) are the fidelity reference for printing.

### Terminology (binding)
- **"Fiche"** (not "formulaire") is used for the annual planning document — teachers know this word. UI copy uses « fiche / fiches ». Nav: « Mes fiches ». Status: « Soumise », « Brouillon », etc. (subject-verb agreement: « la fiche soumise »).
- Sections: **Primaire** / **Secondaire**.
- School approvers, section-aware:
  - Primary fiches → approval by **« le Directeur »**
  - Secondary fiches → approval by **« le Préfet / D.E. »**
  (Used in UI copy such as the "Demander une modification" modal and admin flows.)

---

## 2. Architecture & stack (approved approaches)

1. **Next.js (React) + Supabase** served on Vercel free tier. Supabase provides email/password auth, PostgreSQL schema, Row-Level Security, RPCs. PWA shell (service worker + cache) for offline loading.
2. **Local-first sync engine** (Option 1): IndexedDB local store + outbox queue; row versioning; per-row/cell reconciliation; conflict detection surfacing both versions; atomic server-side transitions.
3. **Print path (Print A):** dedicated print layout with `@page` CSS (A4 **landscape** — matching the paper PDFs) + browser print/“Save as PDF”. Server-generated PDF deferred (Print C as future path).

Dev tooling mirrors user's existing conventions: React 19 ecosystem, Tailwind, dev on port 3001 (port 3000 reserved for Hermes bridge), LAN via LOCAL_LAN_HOST.

---

## 3. Users, roles & access (approved — Part 1)

### Structure
- **Sections**: `Primaire`, `Secondaire`. Everything below belongs to exactly one section.
- **School years** above sections; each year owns its own copy of classes/subjects/assignments/templates/forms (archive + clone rollover).
- **Classes** belong to section + year. Primary: 6 classes, each with one *titulaire*. Secondary: classes; teachers assigned per class + subject.
- **Subject catalogue** shared at school level, tagged by usable section(s). Subject may have optional **sous-branches** (sub-subjects), mainly primary (e.g. Français → Grammaire).
- **Assignment** = class + subject (+ optional sous-branche) + teacher + year. Strict: one teacher per assignment (no co-teaching in v1).

### Roles & permissions matrix

| Capability | Super admin | Section admin (Primaire / Secondaire) | Teacher |
|---|---|---|---|
| Manage users (all), create section admins, reset passwords | ✅ | — | — |
| Manage own section's classes/subjects/assignments, activate cloned year | ✅ (both) | ✅ (own) | — |
| Set/version section form template per year | ✅ | — (view) | — |
| Review submissions, approve unlock requests (own section scope) | ✅ (both) | ✅ (own) | — |
| View all fiches in scope (read-only) | ✅ | ✅ own section | own only |
| Fill + submit own assigned fiches | ✅ if assigned | ✅ if assigned | ✅ |
| Request unlock / see own requests | ✅ if assigned | ✅ if assigned | ✅ |

**Rules**
- Approver must differ from requester. If a section admin is also the teacher requesting on their own fiche, the **super admin** approves.
- One person may hold **multiple roles**; privileges stack; narrowest section scope applies per action.
- Enforcement: Supabase RLS hard boundary (teachers only own assignment rows; section admins only own section; super both) + RPC application rules (requester≠approver, transitions).

### Auth & accounts
- Supabase **email + password**, accounts created by admin (super or section admin scoped). Admin sets initial password; user can change later.
- Recovery: **both** self-service email recovery AND super-admin reset (temporary password).
- Staff profile: **full name, email, optional phone**.

---

## 4. School years, calendar & templates (approved — Part 2)

### School-year lifecycle
- `school_year`: label (2026–2027), dates, status `upcoming | active | archived`.
- Super admin creates year → **clones previous year's structure** (classes/subjects/assignments copied fresh) or starts empty. Section admins review + activate their section's clone (structure only) before use.
- Rollover archives completed year (read-only, printable forever).
- All structure tables carry `school_year_id`; no fiche/assignment spans years.

### Calendar engine (both sections)
1. Super admin enters official calendar: term blocks (primary trimesters / secondary periods+semesters) + special period types/labels (teaching, evaluation, examens, revision, detente, vacances).
2. Engine computes **weekly rows** (Monday-start), sequential numbers.
3. Section admin fine-tunes generated rows (adjust bounds, mark special periods, merge/split rows) to mirror paper quirks.

### Template versioning
- Each section's calendar → **template version** per year: ordered rows with type, week number, date label, period label, column config.
- Once any teacher has drafted against a template, changes create a **new version**; section admin applies it **explicitly only to selected drafts** (rows matched by stable row UUID; content preserved). **Submitted fiches never auto-updated.**

### Fiche (annual plan) structure
- One fiche **per assignment** from the section's active template version.
- Header: school/section/class/subject/sous-branche/teacher/year.
- Grid: template ordered rows; **teaching rows** hold content cells; **event/special rows** carry fixed period label (non-editable except where template permits).
- Rows carry **stable UUIDs** (template application + offline merge key).

### Form status lifecycle
```
brouillon ──submit──▶ soumise ──unlock approved──▶ brouillon (ré-éditable) ──submit──▶ soumise
                ▲                                      │
                └──────────── request refusée ◀────────┘
```
- `brouillon` (draft) editable freely. `soumise` locked; unlock request → responsible admin (section or super; per approver rule) approves → back to draft, teacher edits + resubmits.
- Submit = **atomic server transition**; **completeness gate**: every normal teaching row meets required fields (see §6 columns); event rows no teacher content required.
- Every transition + sync conflict → **immutable activity log** (actor, timestamp, operation, row UUID, prev→new).

---

## 5. Offline sync & data safety (approved — Part 3)

- **PWA**: loads/works offline; UI reads local IndexedDB copy; writes land locally first; Supabase = system of record.
- **Sync queue**: every local mutation is an operation (upsert row / update cell(s) / transition) with target row UUIDs + local sequence. Replayed on reconnect in order, idempotency keys, RPC-per-op.
- Row **version counter** + actor/timestamp; client sends base version edited from; server flags mismatches.
- **Bidirectional** pull after upload (RLS-filtered), merge, reconcile.
- Visible sync status (En ligne / Hors ligne / Synchronisation… / Conflit).
- **Data-safety rules** ("can't close until synced", web-app form):
  1. Persistent local queue — every change committed to IndexedDB immediately.
  2. Before-unload/navigation guard with explicit warning when unsynced ops exist (user may force-close knowingly).
  3. Automatic resume on next launch — sync before showing workspace.
- **Conflicts (cell-level)**: different cells changed on two devices → auto-merge (no loss). Same cell changed to different values → both kept, row `conflit`; next opener (teacher; or admin if unavailable) chooses A/B or edits C; logged. Header fields never editable → never conflict. Status transitions serialized atomically with preconditions → no status conflict.
- **Submit offline**: staged locally with precondition; on sync runs server RPC; server-side validation failure → form back to draft with errors (nothing lost).

---

## 6. Approved screens & UI conventions (all mockups — batches 1–3)

Mockups live in `docs/mockups/` (binding once approved):

**Teacher journey**
- `01-login.html` — Connexion (email+password, forgot, offline sync-resume banner)
- `02-dashboard-enseignant.html` — « Mes fiches », stat cards, fiche table, échéances, activité récente, **modale « Demander une modification »**, **modale « Résolution de conflit »**
- `03-editeur-primaire.html` — Éditeur Primaire (Réf ~6.5 cm wide)
- `04-editeur-secondaire.html` — Éditeur Secondaire (Heure narrow, Matières prévues widest, M.V. + Obs. moderately wide)
- `05-apercu-impression-primaire.html` — Aperçu impression Primaire (**A4 paysage**, 2 pages, BROUILLON watermark on drafts)

**Setup foundation (super admin)**
- `06-gestion-utilisateurs.html` — Gestion des utilisateurs (rôles: super/admin primaire/admin secondaire/enseignant, section, actif, réinit. mdp, import CSV, modale nouvel utilisateur)
- `07-structure.html` — Structure scolaire (classes par section, titulaire, « Cours : N »)
- `08-matieres-sous-branches.html` — **Branches & sous-branches** (catalogue partagé, sections d'usage, sous-branches, filtres, modales nouvelle/modifier branche)
- `09-affectations.html` — **Attributions** (classe + cours + sous-branche + enseignant, modales nouvelle/modifier)
- `10-calendrier.html` — Calendrier & modèles (grille mensuelle — **concept C retenu**)

**Oversight & rollover**
- `11-suivi-fiches-admin.html` — Suivi des fiches (admin section): stats, onglets (toutes/soumissions/demandes/conflits), table filtrable, demandes de réouverture avec **modale « Consulter »** (lecture seule + motif), conflits à résoudre
- `12-notifications.html` — Centre de notifications (in-app, non-lues)
- `13-rollover.html` — Nouvelle année scolaire : **assistant 5 étapes interactif** (1 Paramètres → 2 Structure → 3 Révision sections → 4 Calendriers → 5 Activation)
- `14-apercu-impression-secondaire.html` — Aperçu impression Secondaire (**A4 paysage**, 2 pages, watermark, signature « LE PRÉFET / D.E. »)
- `index.html` — hub / comparateur calendrier (`10-calendrier-comparer.html` garde le concept A pour référence)

### Approved layout conventions
- **Document header** (both sections): top line = school name + address (left) · « Année scolaire : XXXX – XXXX » (right); then a **centered, prominent title band**: « PRÉVISION ANNUELLE » (primaire) / « PRÉVISION DES MATIÈRES » (secondaire); then a **metadata row** (primaire: Section, Classe, Titulaire, Branche, **Sous-branche**; secondaire: Section, Classe, Professeur, Branche).
- **Primary grid**: month column groups by **month** (each month its own group — never combined), weeks numbered sequentially with date ranges; columns: Mois | Semaine — Date | Matières à enseigner | Réf. | Intention | Obs.
- **Secondary grid**: period separator bands (1ʳᵉ/2ᵉ/3ᵉ période, gray) + golden event bands (détente/vacances/révision/examens); columns: N | Semaines | Heure | Matières prévues | M.V. | Obs. (Heure stores only a number, narrow; Matières prévues widest; **M.V. = « Matières vues »**, ~2× wide; Obs. moderately wide).
- **Column semantics / validation**
  - Primary weekly row: **Matières à enseigner, Réf., Intention required**; **Obs. optional**.
  - Secondary weekly row: **Matières prévues, Heure required**; M.V., Obs. optional (M.V. meaning pending final confirmation — see Open questions).
  - Event/special rows: no teacher content requirement.
- **Status colors**: brouillon gray, soumise blue, demande de réouverture amber, conflit red, archive slate.
- **Terminology (binding)**: fiche (annual doc); **cours** = subject as taught/assigned (structure « Cours : N »); **branche** = subject in the shared catalogue; **sous-branche** = optional sub-part (mainly primary); **attribution** = class + cours + teacher assignment; approver per section (Directeur / Préfet-D.E.); « Importer (CSV) » / « Exporter (CSV) »; French-only UI.
- **Calendar builder = grille mensuelle (concept C)**: month-by-month grid, teaching weeks appear as badges on Monday-start cells, event types colored, click a day/side panel to edit; per-section (Primaire/Secondaire); info banner re model versioning (drafts exist → changes create a new version applied manually).

---

## 7. Open questions / to confirm (carried)

- **« M.V. »** secondary column = **« Matières vues »** (confirmed) — records what was actually covered; wide column (~2×).
- Whether **« Heure »** = planned weekly teaching hours (number) — reflected in mockup; confirm with school template.
- Exact shape of primary **month boundaries** where a month spans a partial week (row-to-month assignment rule; current: week belongs to its start month).
- Whether **secondary has a sous-branche option** (paper header shows Branche only).
- Existence/naming of a **« 4ᵉ période »** band in secondary (mockup flagged calendar to confirm).

---

## 8. Remaining work

- **Mockups approved** across all screens (batches 1–3). 
- Write implementation plan (per superpowers workflow), then implement per stack §2.
- Seed with test accounts per role; French UI strings.
- Confirm the open questions in §7 with the school before/while building the affected columns.
