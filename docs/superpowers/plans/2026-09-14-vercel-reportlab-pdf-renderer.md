# Vercel-Compatible Official PDF Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run SILOE’s existing paper-faithful ReportLab PDF renderer as a protected Vercel Python Function, while displaying and downloading the same official PDF through the existing authorised Next.js route.

**Architecture:** The Next.js PDF route remains the only user-facing entry point. It loads the fiche under the caller’s Supabase RLS session, maps that record to a print-only payload, and signs the exact JSON body with an HMAC secret before posting it to a Python Function on the same origin. The Python function validates the signature and renders the existing ReportLab layout with no database credentials. A client PDF.js component fetches the protected PDF route and draws that same PDF into the existing stacked-page preview.

**Tech Stack:** Next.js 16.3.4 App Router, React 19, TypeScript, Vitest 5, Python 3.12 on Vercel / Python 3.11 locally, ReportLab, Vercel Python Functions, PDF.js (`pdfjs-dist`), Supabase SSR/RLS, Vercel CLI.

## Global Constraints

- Work only in `C:/Users/Administrator/dev-worktrees/Prevision_WebApp-vercel-pdf` on branch `feature/vercel-reportlab-pdf`.
- Keep `master` and Vercel’s `main` untouched until all local acceptance checks pass and the user explicitly approves promotion.
- Preserve the current ReportLab layout exactly: A4 landscape geometry, Source Sans TTFs, column widths, measured table height, watermark, headers, signature placement, and page numbers.
- Do not use HTML/Chrome/Puppeteer or a second JavaScript layout engine to generate the official PDF.
- The Python Function must never hold, read, log, or receive `SUPABASE_SERVICE_ROLE_KEY`.
- Add a server-only `PDF_RENDERER_SECRET`; it must never use a `NEXT_PUBLIC_` name, enter source control, or appear in error responses.
- Do not create a Vercel Preview deployment or a preview Supabase project. Required deployment proof is local `vercel dev` and `vercel build`.
- Keep the existing public PDF URL: `/impression/[ficheId]/pdf`.
- Keep all visible product copy in French. Any new loading/error UI needs mockup approval before implementation.
- Do not commit or promote this feature automatically. Stop at the documented release checkpoint and request explicit approval.

---

## File structure

| Path | Responsibility |
|---|---|
| Create `src/lib/pdf-renderer-contract.ts` | Print-only TypeScript payload types, mapping from `FicheWithRows`, size bounds, canonical JSON request envelope, and HMAC signing helpers. |
| Create `src/lib/__tests__/pdf-renderer-contract.test.ts` | Pure Vitest regression tests for payload mapping, value-only cells, deterministic signing, and rejected over-limit input. |
| Create `python/official_pdf/__init__.py` | Python package marker and curated exports. |
| Create `python/official_pdf/contracts.py` | Python payload parser/validator shared only by the Vercel function. |
| Create `python/official_pdf/renderer.py` | Pure ReportLab renderer that accepts the authorised print payload and returns PDF bytes. |
| Create `python/tests/test_contracts.py` | Python standard-library tests for allowed/rejected request payloads and HMAC expiry rules. |
| Create `api/render_pdf.py` | Vercel Python Function: verify signed request and return `application/pdf`. |
| Create `requirements.txt` | Vercel Python runtime dependency declaration containing ReportLab only. |
| Create `vercel.json` | Includes the Python package and Source Sans `.ttf` files in the Python Function bundle; sets an explicit bounded execution duration. |
| Create `src/components/print/pdf-preview.tsx` | Client PDF.js preview of the protected PDF, with approved loading/error UI. |
| Create `docs/mockups/17-pdf-preview-loading-error.html` | Binding mockup for the only new visible loading/error states. |
| Modify `scripts/rendu_pdf.py` | Keep local Supabase data loading and CLI flags, but map to the shared payload and call the pure Python renderer. |
| Modify `src/lib/print-pdf.ts` | Replace production `spawn("python")` with signed same-origin Vercel Function call; preserve explicit local Python fallback. |
| Modify `src/app/(app)/impression/[ficheId]/page.tsx` | Retain session/RLS route guard and page shell; replace server PNG data URLs with `PdfPreview`. |
| Modify `src/app/(app)/impression/[ficheId]/pdf/route.ts` | Retain session/RLS guard and stream the single official PDF output. |
| Modify `src/components/print/pdf-download-button.tsx` | Keep download behavior, add correct PDF-route error handling, and remove stale renderer comment. |
| Modify `package.json`, `package-lock.json` | Declare `pdfjs-dist` directly rather than relying on its transitive presence through `pdf-parse`. |
| Modify `.env.example` | Document the server-only renderer secret by name only; do not include a real value. |
| Modify `docs/TESTING.md` | Add local `vercel dev`, renderer security, fidelity, and release checks. |

---

### Task 1: Establish the signed, print-only TypeScript contract

**Files:**
- Create: `src/lib/pdf-renderer-contract.ts`
- Create: `src/lib/__tests__/pdf-renderer-contract.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `FicheWithRows` from `src/lib/fiche-types.ts`.
- Produces: `PdfPayload`, `RendererEnvelope`, `toPdfPayload(fiche)`, `createRendererEnvelope(payload, secret, nowMs)`, and `verifyRendererBounds(payload)`.
- Produces: a direct `pdfjs-dist` production dependency pinned from the currently installed transitive version `5.4.296`.

- [ ] **Step 1: Write the failing Vitest cases for authorised payload conversion**

Create `src/lib/__tests__/pdf-renderer-contract.test.ts` with fixture data using the real `FicheWithRows` shape. Assert that only print-required fields cross the boundary, cell objects become plain string values, and unneeded ids/versions are not included in the rows.

```ts
import { describe, expect, it } from "vitest";
import { createRendererEnvelope, toPdfPayload } from "@/lib/pdf-renderer-contract";
import type { FicheWithRows } from "@/lib/fiche-types";

const fiche = {
  fiche: { id: "fiche-1", statut: "brouillon" },
  meta: {
    section: "primaire",
    classe: "6e B",
    cours: "Français",
    sous_branche: null,
    enseignant: "Mbuyi Kabongo",
    school_year_label: "2026–2027",
  },
  rows: [{
    id: "row-db-id",
    fiche_id: "fiche-1",
    row_uuid: "row-stable-id",
    ordre: 1,
    row_type: "enseignement",
    mois: "Septembre",
    semaine_num: 1,
    date_label: "01/09/2026 → 04/09/2026",
    periode_label: null,
    evenement_label: null,
    cells: { matieres: { id: "cell-id", value: "Lecture", version: 3 } },
  }],
} as unknown as FicheWithRows;

describe("toPdfPayload", () => {
  it("maps the RLS-authorised fiche to printable values only", () => {
    expect(toPdfPayload(fiche)).toMatchObject({
      fiche: { id: "fiche-1", statut: "brouillon" },
      meta: { section: "primaire", annee: "2026–2027" },
      rows: [{ ordre: 1, cells: { matieres: "Lecture" } }],
    });
    expect(JSON.stringify(toPdfPayload(fiche))).not.toContain("cell-id");
    expect(JSON.stringify(toPdfPayload(fiche))).not.toContain("row-db-id");
  });

  it("creates a deterministic signed envelope for an injected timestamp", () => {
    const payload = toPdfPayload(fiche);
    expect(createRendererEnvelope(payload, "test-secret", 1_700_000_000_000)).toEqual(
      createRendererEnvelope(payload, "test-secret", 1_700_000_000_000)
    );
  });
});
```

- [ ] **Step 2: Run the new test to confirm it fails for missing contract exports**

Run:

```bash
npm test -- src/lib/__tests__/pdf-renderer-contract.test.ts
```

Expected: FAIL because `@/lib/pdf-renderer-contract` does not exist.

- [ ] **Step 3: Add the explicit browser PDF dependency**

Add the direct dependency using the already-installed version, so the preview does not depend on `pdf-parse` retaining it transitively:

```bash
npm install pdfjs-dist@5.4.296
```

Expected: `package.json` lists `"pdfjs-dist": "^5.4.296"` under `dependencies`; `package-lock.json` records the direct dependency.

- [ ] **Step 4: Implement the payload and HMAC contract**

Create `src/lib/pdf-renderer-contract.ts`. It must use `node:crypto` only from server code and define exactly these serialisable shapes:

```ts
export type PdfPayload = {
  fiche: { id: string; statut: "brouillon" | "soumise" };
  meta: {
    section: "primaire" | "secondaire";
    classe: string;
    cours: string;
    sousBranche: string | null;
    enseignant: string;
    annee: string;
  };
  rows: Array<{
    ordre: number;
    rowType: "enseignement" | "evenement";
    mois: string | null;
    semaineNum: number | null;
    dateLabel: string | null;
    periodeLabel: string | null;
    evenementLabel: string | null;
    cells: Record<string, string>;
  }>;
};

export type RendererEnvelope = {
  issuedAt: number;
  payload: PdfPayload;
};
```

Implement:

```ts
export function toPdfPayload(fiche: FicheWithRows): PdfPayload;
export function verifyRendererBounds(payload: PdfPayload): void;
export function createRendererEnvelope(
  payload: PdfPayload,
  secret: string,
  nowMs?: number
): { body: string; signature: string; issuedAt: number };
```

Rules:

- `toPdfPayload` maps `row_type`, `semaine_num`, `date_label`, `periode_label`, and `evenement_label` to the contract’s camelCase names.
- It maps `cells[col].value` to `cells[col]` and emits an empty object when a row has no cells.
- It never passes cell ids, row database ids, attribution ids, versions, submission timestamps, sessions, roles, or profile phone numbers.
- `verifyRendererBounds` rejects more than 400 rows, any label over 1,000 characters, any cell value over 20,000 characters, and an empty fiche id.
- `createRendererEnvelope` sets `issuedAt = Math.floor(nowMs / 1000)`, serialises exactly `JSON.stringify({ issuedAt, payload })`, and calculates a SHA-256 HMAC in hex over that exact body.

- [ ] **Step 5: Extend the contract tests for safety bounds**

Add assertions that an oversized cell and over-400-row payload throw a stable error before a request is sent.

```ts
it("rejects renderer input that exceeds the hard document bounds", () => {
  const oversized = structuredClone(toPdfPayload(fiche));
  oversized.rows[0].cells.matieres = "x".repeat(20_001);
  expect(() => createRendererEnvelope(oversized, "test-secret", 1)).toThrow(
    "Le document dépasse la taille autorisée."
  );
});
```

- [ ] **Step 6: Run contract tests and the full existing suite**

Run:

```bash
npm test -- src/lib/__tests__/pdf-renderer-contract.test.ts
npm test
npx tsc --noEmit
```

Expected: all existing 40 tests plus the contract tests pass; TypeScript reports no errors.

- [ ] **Step 7: Checkpoint**

Do not commit. Confirm that the contract has no Supabase import, no client import, and no `NEXT_PUBLIC_` secret.

---

### Task 2: Extract the existing ReportLab layout into a pure renderer

**Files:**
- Create: `python/official_pdf/__init__.py`
- Create: `python/official_pdf/renderer.py`
- Modify: `scripts/rendu_pdf.py`
- Create: `python/tests/test_renderer.py`

**Interfaces:**
- Consumes: `PdfPayload`-equivalent Python dictionary with printable strings only.
- Produces: `render_pdf(payload: dict) -> bytes`.
- Preserves: the local CLI flags `--fiche`, `--liste`, `--out`, `--stdout`, `--png-stdout`, and `--apercu`.

- [ ] **Step 1: Write a failing Python renderer test**

Create `python/tests/test_renderer.py` using `unittest`. Read only an in-memory payload fixture; do not connect to Supabase.

```python
import unittest
from python.official_pdf.renderer import render_pdf

class RenderPdfTests(unittest.TestCase):
    def test_primary_draft_is_a_landscape_a4_pdf(self):
        pdf = render_pdf({
            "fiche": {"id": "fixture", "statut": "brouillon"},
            "meta": {
                "section": "primaire", "classe": "6e B", "cours": "Français",
                "sousBranche": None, "enseignant": "Mme Exemple", "annee": "2026–2027",
            },
            "rows": [{
                "ordre": 1, "rowType": "enseignement", "mois": "Septembre",
                "semaineNum": 1, "dateLabel": "01/09/2026 → 04/09/2026",
                "periodeLabel": None, "evenementLabel": None,
                "cells": {"matieres": "Lecture", "ref": "", "intention": "", "obs": ""},
            }],
        })
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 1_000)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the Python test and confirm it fails before extraction**

Run:

```bash
python -m unittest python.tests.test_renderer
```

Expected: FAIL with `ModuleNotFoundError: No module named 'python.official_pdf'`.

- [ ] **Step 3: Move layout-only code into `renderer.py` without changing layout constants**

Move the current ReportLab layout code from `scripts/rendu_pdf.py` into `python/official_pdf/renderer.py`:

- page geometry and constants;
- Source Sans TTF registration from a path derived from `Path(__file__)` to `src/app/fonts`;
- page splitting, header, signature, table, watermark, and two-pass canvas logic;
- cell render helpers.

Replace file-output-only rendering with this entry point:

```python
from io import BytesIO

def render_pdf(payload: dict) -> bytes:
    output = BytesIO()
    build_pdf(payload, output)
    return output.getvalue()
```

`build_pdf` may accept either a binary file-like object or a path, but the Vercel path must use `BytesIO`, not a persistent file. Construct the renderer’s internal row mapping from the approved payload names (`rowType`, `semaineNum`, `dateLabel`, `periodeLabel`, `evenementLabel`, `sousBranche`, `annee`).

Use the correct local date explicitly:

```python
from datetime import datetime
from zoneinfo import ZoneInfo

def lubumbashi_date() -> str:
    return datetime.now(ZoneInfo("Africa/Lubumbashi")).strftime("%d/%m/%Y")
```

Use `lubumbashi_date()` in the signature block instead of `date.today()`.

- [ ] **Step 4: Refactor the CLI to become a data loader only**

Keep the existing local `Supabase` REST reader and CLI argument surface in `scripts/rendu_pdf.py`, but map its query result to the same printable payload before calling `render_pdf(payload)`.

For binary output:

```python
if args.stdout:
    sys.stdout.buffer.write(render_pdf(payload))
    return
```

Keep `--png-stdout` only for the local CLI. It may call the existing `pypdfium2` helper after writing the returned bytes to a temporary local file. Do not import or package `pypdfium2` in the Vercel function.

- [ ] **Step 5: Run pure-Python and CLI regression checks**

Run:

```bash
python -m py_compile scripts/rendu_pdf.py python/official_pdf/renderer.py
python -m unittest python.tests.test_renderer
python scripts/rendu_pdf.py --help
```

Expected: syntax passes; unit test passes; CLI still lists all existing flags.

- [ ] **Step 6: Compare local official output against the approved geometry**

With the local Supabase dev stack and demo fiche available, run:

```bash
python scripts/rendu_pdf.py --fiche <primary-fiche-id> --out docs/out/pdf-refactor-primary.pdf
python scripts/rendu_pdf.py --fiche <secondary-fiche-id> --out docs/out/pdf-refactor-secondary.pdf
```

Then measure both with `pdfplumber`:

```python
import pdfplumber
with pdfplumber.open("docs/out/pdf-refactor-primary.pdf") as pdf:
    assert pdf.pages[0].width == 841.8898
    assert pdf.pages[0].height == 595.2756
```

Compare the grid lines, embedded Source Sans font names, page count, title/header, watermark, and signature placement against the approved local reference PDFs. Do not accept a visual-only comparison.

- [ ] **Step 7: Checkpoint**

Do not commit. Report the measured comparison and stop if any approved print geometry changed.

---

### Task 3: Add the private Vercel Python Function

**Files:**
- Create: `python/official_pdf/contracts.py`
- Create: `python/tests/test_contracts.py`
- Create: `api/render_pdf.py`
- Create: `requirements.txt`
- Create: `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: exact JSON body `{"issuedAt": number, "payload": PdfPayload}` plus `X-Prevision-Pdf-Signature`.
- Produces: `200 application/pdf`, `401` for missing/invalid/expired signatures, and `400` for a validly signed malformed payload.
- Depends on: `PDF_RENDERER_SECRET` only; never Supabase keys.

- [ ] **Step 1: Write failing Python contract/security tests**

Create `python/tests/test_contracts.py` with deterministic fixed time. Test these exact outcomes:

```python
self.assertTrue(verify_hmac(body, signature, "secret"))
self.assertFalse(verify_hmac(body, "bad", "secret"))
self.assertRaises(ExpiredRendererRequest, parse_signed_envelope, stale_body, "secret", 1_700_000_061)
self.assertRaises(InvalidRendererPayload, parse_signed_envelope, malformed_body, "secret", 1_700_000_001)
```

Use a 60-second maximum age. Test that unknown top-level fields, an invalid section, a non-string cell value, an empty fiche id, and excess rows are rejected.

- [ ] **Step 2: Run the test and confirm it fails before implementation**

Run:

```bash
python -m unittest python.tests.test_contracts
```

Expected: FAIL because `python.official_pdf.contracts` does not exist.

- [ ] **Step 3: Implement Python request validation**

In `python/official_pdf/contracts.py`, use only standard-library `json`, `hmac`, `hashlib`, and `time` for the security boundary. Implement:

```python
MAX_AGE_SECONDS = 60

def verify_hmac(body: bytes, signature: str, secret: str) -> bool: ...
def parse_signed_envelope(body: bytes, secret: str, now: int | None = None) -> dict: ...
```

Rules:

- Compute `hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()`.
- Compare with `hmac.compare_digest`; never use `==` for signature comparison.
- Reject `issuedAt` in the future by more than 5 seconds or more than 60 seconds old.
- Require exactly `issuedAt` and `payload` at the envelope root.
- Enforce the same field and size limits as `verifyRendererBounds` in the TypeScript contract.
- Raise explicit internal exception classes; the HTTP function maps them to generic French error messages without returning a stack trace.

- [ ] **Step 4: Implement the Vercel handler**

Create `api/render_pdf.py` using Vercel’s Python HTTP handler shape. Its `POST` flow must be:

```python
secret = os.environ.get("PDF_RENDERER_SECRET")
if not secret:
    return json_response(500, {"error": "Configuration PDF indisponible."})

try:
    payload = parse_signed_envelope(request_body, secret)
    pdf = render_pdf(payload)
except InvalidRendererSignature:
    return json_response(401, {"error": "Non autorisé."})
except InvalidRendererPayload:
    return json_response(400, {"error": "Document invalide."})
except Exception:
    return json_response(500, {"error": "Impossible de générer le PDF."})

return binary_response(200, pdf, "application/pdf")
```

The handler must:

- accept POST only and return `405` for other methods;
- avoid database imports, `.env.local` reading, Supabase imports, and service-role references;
- use the pure `render_pdf(payload)` function;
- set `Content-Type: application/pdf` and `Cache-Control: no-store` for successful output;
- write only to `/tmp` if a temporary file is ever required.

- [ ] **Step 5: Define Vercel’s Python bundle explicitly**

Create `requirements.txt` containing only:

```text
reportlab==4.4.10
```

Create `vercel.json` with the Python Function bundle including the renderer module and font assets:

```json
{
  "functions": {
    "api/render_pdf.py": {
      "includeFiles": [
        "python/official_pdf/**",
        "src/app/fonts/SourceSans3-*.ttf"
      ],
      "maxDuration": 60
    }
  }
}
```

If the current Vercel configuration schema accepts only a string glob for `includeFiles`, use the documented comma-separated equivalent and validate it with `npx vercel build`; do not silently remove font inclusion.

- [ ] **Step 6: Document the secret without creating one in source control**

Append to `.env.example`:

```dotenv
# Server-to-server HMAC secret for the private Vercel ReportLab function.
# Create it in Vercel Production only; never prefix it with NEXT_PUBLIC_.
# PDF_RENDERER_SECRET=
```

Do not write a real secret value to `.env.example`, a test fixture, shell history, docs, or chat.

- [ ] **Step 7: Run security, syntax, and Vercel packaging checks**

Run:

```bash
python -m py_compile api/render_pdf.py python/official_pdf/contracts.py
python -m unittest python.tests.test_contracts
npx vercel build
```

Expected: both Python suites pass, and Vercel creates a build output containing `api/render_pdf.py`, the pure renderer module, and Source Sans TTF assets.

- [ ] **Step 8: Checkpoint**

Do not commit. Inspect the build output/file trace; fail the task if `SUPABASE_SERVICE_ROLE_KEY`, `.env.local`, or `pypdfium2` is included in the Python Function’s runtime dependency path.

---

### Task 4: Replace the production Node shell-out with the signed renderer bridge

**Files:**
- Modify: `src/lib/print-pdf.ts`
- Modify: `src/app/(app)/impression/[ficheId]/pdf/route.ts`
- Create: `src/lib/__tests__/print-pdf.test.ts`

**Interfaces:**
- Consumes: RLS-authorised `FicheWithRows`, request origin, and `PDF_RENDERER_SECRET`.
- Produces: official PDF bytes from either the local pure Python fallback or the Vercel Python Function.
- Preserves: `/impression/[ficheId]/pdf` success headers and error status semantics.

- [ ] **Step 1: Write failing unit tests for renderer selection and HTTP error mapping**

Mock `fetch` and the pure contract helpers in `src/lib/__tests__/print-pdf.test.ts`. Cover:

```ts
it("posts the signed envelope only to the same-origin Python endpoint", async () => {
  await generateFichePdf(fiche, "https://previsions-matiere.vercel.app", { mode: "vercel" });
  expect(fetch).toHaveBeenCalledWith(
    "https://previsions-matiere.vercel.app/api/render_pdf",
    expect.objectContaining({ method: "POST" })
  );
});

it("rejects a non-PDF renderer response without exposing its body", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("secret stack trace", { status: 500 }));
  await expect(generateFichePdf(fiche, "https://example.test", { mode: "vercel" }))
    .rejects.toThrow("Impossible de générer le PDF.");
});
```

- [ ] **Step 2: Run the test to confirm it fails against the current spawn-only implementation**

Run:

```bash
npm test -- src/lib/__tests__/print-pdf.test.ts
```

Expected: FAIL because `generateFichePdf` does not accept authorised fiche data or a renderer mode.

- [ ] **Step 3: Refactor `src/lib/print-pdf.ts` around the shared payload**

Replace its public interface with:

```ts
export type PdfRendererMode = "local" | "vercel";

export async function generateFichePdf(
  fiche: FicheWithRows,
  origin: string,
  options?: { mode?: PdfRendererMode }
): Promise<Buffer>;
```

Mode selection:

```ts
const mode = options?.mode
  ?? (process.env.PDF_RENDERER_MODE as PdfRendererMode | undefined)
  ?? (process.env.VERCEL ? "vercel" : "local");
```

For `vercel` mode:

- require `PDF_RENDERER_SECRET` and throw only `"Configuration PDF indisponible."` when absent;
- call `toPdfPayload` and `createRendererEnvelope`;
- POST the exact body to `new URL("/api/render_pdf", origin)`;
- send only `Content-Type: application/json` and `X-Prevision-Pdf-Signature` headers;
- require `response.ok` and `response.headers.get("content-type")?.includes("application/pdf")`;
- return `Buffer.from(await response.arrayBuffer())`;
- never include the upstream response body in an exception.

For `local` mode:

- call the same pure Python renderer through a new local CLI flag such as `--payload-stdin`;
- write the payload to stdin and read PDF bytes from stdout;
- do not allow the local Node bridge to give the Python process database credentials or a fiche id;
- retain `PYTHON_BIN` as the interpreter override.

Remove `generateFichePageImages`; Vercel must never generate server-side base64 PNG previews.

- [ ] **Step 4: Update the protected route**

In `src/app/(app)/impression/[ficheId]/pdf/route.ts`, preserve these existing guard lines before any renderer call:

```ts
const user = await getSessionUser();
if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

const fiche = await getFicheForUser(ficheId);
if (!fiche) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
```

Use the incoming request to obtain the same-origin base URL:

```ts
const pdf = await generateFichePdf(fiche, _req.nextUrl.origin);
```

Keep:

```ts
"Content-Type": "application/pdf",
"Content-Disposition": `inline; filename="prevision-${ficheId}.pdf"`,
"Cache-Control": "no-store",
```

Map renderer failure to the existing French `500` JSON shape. Do not return the internal function’s body or signature detail.

- [ ] **Step 5: Run TypeScript and unit regression checks**

Run:

```bash
npm test -- src/lib/__tests__/print-pdf.test.ts src/lib/__tests__/pdf-renderer-contract.test.ts
npm test
npx tsc --noEmit
```

Expected: new bridge tests and all existing tests pass.

- [ ] **Step 6: Checkpoint**

Do not commit. Use a code search to prove the production PDF path contains no `SUPABASE_SERVICE_ROLE_KEY`, no `.env.local` read, and no `generateFichePageImages` import.

---

### Task 5: Mock and approve the PDF preview loading/error states

**Files:**
- Create: `docs/mockups/17-pdf-preview-loading-error.html`

**Interfaces:**
- Consumes: current visual design from `src/app/(app)/impression/[ficheId]/page.tsx`.
- Produces: binding approved states for loading the protected official PDF and for an unavailable render.

- [ ] **Step 1: Create the narrow static mockup**

Create one HTML file with two state panels, retaining the current page toolbar and page-stack width:

```text
State A — Chargement de l’aperçu…
- Existing white toolbar, back link, title, status pill, and disabled “Télécharger le PDF” button remain visible.
- Two stacked white A4-landscape page placeholders use the current `max-w-[1100px]`, border, and shadow treatment.
- A small neutral French status line reads: “Préparation de l’aperçu officiel…”

State B — Erreur de rendu
- Same toolbar and no fake document page.
- Existing red alert treatment reads: “Impossible de préparer l’aperçu. Réessayez dans un instant.”
- A visible retry action reads: “Réessayer”.
```

Do not add new navigation, product labels, colours, or unrelated controls.

- [ ] **Step 2: Verify the mockup in a browser**

Open the file with the local browser tooling and confirm:

- toolbar remains visually identical to the current impression page;
- loading panel does not shift when pages appear;
- error/retry copy is readable on a phone-width viewport;
- no Tailwind CDN or unsupported `@apply` technique is used.

- [ ] **Step 3: Request and wait for user approval**

Stop implementation here. Present the verified mockup and ask the user to approve or correct it. Do not implement `PdfPreview` until the mockup is approved.

---

### Task 6: Implement client-side preview of the exact protected PDF

**Files:**
- Create: `src/components/print/pdf-preview.tsx`
- Modify: `src/app/(app)/impression/[ficheId]/page.tsx`
- Modify: `src/components/print/pdf-download-button.tsx`

**Interfaces:**
- Consumes: `ficheId` and the protected `/impression/[ficheId]/pdf` route.
- Produces: stacked canvases rendered from the official PDF, never a recreated HTML document.
- Preserves: page server-side session/RLS guard and the existing download URL.

- [ ] **Step 1: Write a focused component test or extraction test for request state handling**

Extract PDF fetch state to a small testable helper if necessary. Assert that a non-OK protected route result maps to the approved French error and that retry starts a fresh request.

```ts
expect(pdfPreviewError(new Response(null, { status: 401 }))).toBe(
  "Impossible de préparer l’aperçu. Réessayez dans un instant."
);
```

- [ ] **Step 2: Implement `PdfPreview` as a client component**

Use direct `pdfjs-dist` imports, not the `pdf-parse` transitive dependency. Configure the PDF.js worker from the same installed package version. On mount and retry:

```ts
const response = await fetch(`/impression/${ficheId}/pdf`, { cache: "no-store" });
if (!response.ok) throw new Error("PDF_FETCH_FAILED");
const bytes = await response.arrayBuffer();
const document = await getDocument({ data: bytes }).promise;
```

For each PDF page:

- obtain the viewport at a deterministic scale;
- render it to a `<canvas>`;
- convert it to an object URL or retain the canvas directly;
- release the `PDFDocumentProxy` and object URLs on component cleanup.

Render the approved loading/error mockup states. Keep canvases inside the current white bordered/shadowed page containers. Use accessible image/canvas labels such as `Aperçu — page 1 sur 2`.

- [ ] **Step 3: Replace server PNG generation in the impression page**

In `src/app/(app)/impression/[ficheId]/page.tsx`:

- remove `generateFichePageImages` import and its `try/catch` data URL block;
- retain `getSessionUser`, `getFicheForUser`, redirect, `notFound`, toolbar, title, and status pill;
- render `<PdfPreview ficheId={ficheId} />` in the existing page-stack container.

This page must not trigger a render before the browser fetches the protected PDF route.

- [ ] **Step 4: Align download button messaging**

Keep blob-download behaviour in `PdfDownloadButton`. Remove the inaccurate comment about Chrome headless, and use the route’s French generic PDF error without exposing renderer details.

- [ ] **Step 5: Run unit/build checks**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests pass; Next build has no traced local `child_process.spawn` warning in the Vercel production path.

- [ ] **Step 6: Browser verification on local `npm run dev`**

Run the feature app on a non-conflicting port and use a real authenticated teacher session:

```bash
PDF_RENDERER_MODE=local npm run dev -- -p 3002
```

Verify:

- `/impression/[ficheId]` loads two rendered pages without a download event;
- `Télécharger le PDF` downloads a valid PDF;
- draft fiche includes the watermark;
- submitted fiche does not include the watermark;
- mobile-width preview remains usable;
- direct `/impression/[other-fiche-id]/pdf` returns `404` for an authorised but out-of-scope user.

- [ ] **Step 7: Checkpoint**

Do not commit. Capture measured PDF output and browser evidence before Vercel-runtime testing.

---

### Task 7: Prove Vercel runtime locally, document the recovery path, and gate production

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/superpowers/specs/2026-09-14-vercel-reportlab-pdf-renderer-design.md` only if verification exposes a corrected implementation fact.

**Interfaces:**
- Consumes: complete feature branch and local Vercel configuration.
- Produces: reproducible local runtime proof and a decision-ready production release gate.

- [ ] **Step 1: Add no-secret local environment instructions**

Update `docs/TESTING.md` with the exact environment variable names and no secret values:

```text
PDF_RENDERER_MODE=local      → test the Node-to-local-Python fallback.
PDF_RENDERER_MODE=vercel     → test Node-to-Vercel-Python route through vercel dev.
PDF_RENDERER_SECRET          → required by both bridge and Python Function; set only in ignored local environment files and Vercel Production.
```

State that `SUPABASE_SERVICE_ROLE_KEY` remains outside the Vercel Python Function and is never sent to it.

- [ ] **Step 2: Build the Vercel deployment locally**

With local renderer secret configured through an ignored environment file, run:

```bash
npx vercel build
PDF_RENDERER_MODE=vercel npx vercel dev --listen 3002
```

In a second terminal, authenticate with a local test teacher and exercise the preview and download endpoints against `http://localhost:3002`. Do not test with the production Supabase project.

- [ ] **Step 3: Verify the private renderer boundary directly**

Against the local `vercel dev` process, run these checks:

```bash
curl -i -X POST http://localhost:3002/api/render_pdf
curl -i -X POST http://localhost:3002/api/render_pdf \
  -H 'Content-Type: application/json' \
  --data '{"issuedAt":0,"payload":{}}'
```

Expected: both return `401` without a stack trace, PDF data, Supabase details, or secret information.

Then confirm that the authorised browser route returns `200`, `Content-Type: application/pdf`, and a PDF below 4 MB for a maximum-content fixture.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
python -m unittest python.tests.test_renderer python.tests.test_contracts
npx vercel build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 5: Record the release evidence**

Add the exact commands and observed outcomes to `docs/TESTING.md`:

- local unit, type, and Next production build;
- Python renderer/contract tests;
- local `vercel build` and `vercel dev` proof;
- valid authorised preview/download;
- direct renderer rejection;
- primary/secondary PDF geometry measurements;
- maximum PDF byte size;
- mobile preview pass.

- [ ] **Step 6: Production release checkpoint**

Stop here and present:

1. the complete feature diff;
2. all local verification outputs;
3. the exact feature commit SHA proposed for release;
4. the current `main` SHA and the exact fast-forward/promotion command;
5. required Vercel Production environment action: add `PDF_RENDERER_SECRET` securely before deployment;
6. the residual risk: without a remote preview environment, Vercel Production is the first remote Linux runtime execution.

Do not commit, push, merge, or deploy until the user explicitly approves the production release.
