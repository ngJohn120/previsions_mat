# Rapport — Interférence de l'« IDM Advanced Integration » sur la vérification PDF (Win 11)

**Auteur :** agent Alfred (Hermes) — **Date :** 2026-09-16
**Contexte :** vérification navigateur de l'aperçu PDF.js du PDF officiel ReportLab (Prevision WebApp, worktree `feature/vercel-reportlab-pdf`).
**Statut :** contourné — vérification 11/11 réussie avec un navigateur non hooké.

---

## 1. Symptôme

Toute **requête `fetch()` d'un PDF exécutée dans un navigateur Chromium/Edge** (headless ou non, profil vierge ou profil système) sur cette machine retournait :

```
HTTP 204 No Content
StatusText: "Intercepted by the IDM Advanced Integration"
Headers:  cache-control: no-cache, connection: close, pragma: no-cache
Body:    0 octets
```

Conséquences observées :

- `PdfPreview` recevait un corps vide → `InvalidPDFException: The PDF file is empty, i.e. its size is zero bytes.` → l'état d'erreur approuvé s'affichait (« Impossible de préparer l'aperçu. Réessayez dans un instant. »).
- Le **téléchargement** (`fetch` depuis Node / navigation directe / curl) fonctionnait parfaitement : `200 application/pdf`, 40 269 octets, `%PDF-`, filigrane BROUILLON présent.
- La page modèle, le worker `pdf.worker.min.mjs` (200), le routage Next et le serveur Python/ReportLab n'étaient **pas** en cause.

## 2. Faits établis (preuves)

| # | Test | Résultat |
|---|------|----------|
| 1 | `fetch` navigateur (Chrome système) | **204 IDM**, 0 octet |
| 2 | `fetch` navigateur (profil temporaire `--user-data-dir`) | **204 IDM**, 0 octet |
| 3 | `fetch` navigateur (`--disable-extensions` + profil vierge) | **204 IDM**, 0 octet |
| 4 | `fetch` navigateur (Edge système, profil vierge) | **204 IDM**, 0 octet |
| 5 | `fetch` navigateur (Chromium autonome Playwright, profil vierge) | **204 IDM**, 0 octet |
| 6 | `fetch` navigateur (**chrome-headless-shell** Playwright) | **200 OK — 40 269 octets** ✅ |
| 7 | Même URL via **Node** (`fetch` + cookie session) | **200 OK — 40 269 octets** ✅ |
| 8 | Service worker `public/sw.js` (le code exclut déjà `/pdf`) | éliminé (toujours 204 sans SW) |
| 9 | `IDMan.exe` actif pendant les tests ; arrêté ensuite | 204 **persistant** même process arrêté |
| 10 | Désactivation de l'intégration IDM par l'utilisateur (UI IDM) | 204 **persistant** pour les binaires hookés |

Conclusion : le hook est attaché **aux binaires navigateur installés** (Chrome, Edge, Chromium Playwright) — vraisemblablement via l'extension « intégration navigateur » d'Internet Download Manager (IDM), chargée indépendamment des profils. Le `chrome-headless-shell` (binaire séparé, non référencé par l'intégration IDM) n'est pas affecté.

## 3. Impact réel

- **Applicatif : aucun.** Le serveur renvoie le PDF correct (vérifié en continu : 200, %PDF-, 40 Ko, filigrane). Le rendu PDF.js est validé : 2 pages, table fidèle, filigrane BROUILLON visible, compteur « Page 1 / 2 », aucune régression visuelle.
- **Vérification automatisée locale : bloquée** tant que le navigateur exécuté est un binaire hooké par IDM. Les machines des utilisateurs finaux (école, sans IDM) ne sont pas concernées ; un utilisateur ayant IDM activé verrait l'état d'erreur de l'aperçu (comportement conçu) mais le PDF resterait téléchargeable.

## 4. Décision & contournement retenu

1. Le script `scripts/verify-pdf-preview.mjs` tente désormais d'utiliser dans l'ordre :
   `chrome-headless-shell` (Playwright, sûr) → Chromium Playwright → Chrome système → Edge système.
2. Preuve finale : **11/11 checks PASS** avec `chrome-headless-shell` :
   login, barre d'outils, chip « Brouillon », aperçu PDF.js **2 pages**, compteur de pages, téléchargement `200 %PDF`, glyphes du filigrane, aperçu secondaire, mobile 390 px sans débordement, aperçu mobile.
3. Capture visuelle conservée : `docs/out/preview-page-1.png` (vérifiée : en-tête école, métadonnées SECTION/CLASSE/BRANCHE, tableau 6 colonnes, filigrane BROUILLON diagonal, « — Page 1 / 2 — »).

## 5. Recommandations

- **Machine de dev :** ne pas installer/réactiver l'intégration navigateur d'IDM si l'on veut des tests navigateur non faussés ; privilégier `chrome-headless-shell` pour toute vérification PDF automatisée.
- **Production :** aucune action requise (pas d'IDM côté utilisateurs). Si un établissement devait équiper les postes d'un outil du même type, l'aperçu affichera l'état d'erreur approuvé — comportement documenté et sans risque de données.
- **Script de vérification :** conserver le fallback headless-shell (1re priorité) afin que le contrôle reste reproductible sur cette machine.

## 6. Pièces jointes

- `scripts/verify-pdf-preview.mjs` — harnais de vérification (binaire sûr prioritaire).
- `docs/out/preview-page-1.png` — capture de l'aperçu PDF.js rendu (2 pages, filigrane).
- Sortie de référence : `11/11 checks passed` (2026-09-16, serveur local :3002, mode `PDF_RENDERER_MODE=local`).