import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FicheWithRows } from "@/lib/fiche-types";
import type { PdfPayload } from "@/lib/pdf-renderer-contract";
import { generateFichePdf } from "@/lib/print-pdf";

vi.mock("@/lib/pdf-renderer-contract", () => ({
  toPdfPayload: vi.fn((fiche: FicheWithRows) => ({
    fiche: { id: fiche.fiche.id, statut: fiche.fiche.statut },
    meta: { section: "primaire", classe: "6e B", cours: "Français", sousBranche: null, enseignant: "Mme Exemple", annee: "2026–2027" },
    rows: [],
  }) as PdfPayload),
  createRendererEnvelope: vi.fn(() => ({
    body: JSON.stringify({ issuedAt: 1_700_000_000, payload: {} }),
    signature: "abc123",
    issuedAt: 1_700_000_000,
  })),
}));

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
  rows: [],
} as unknown as FicheWithRows;

describe("generateFichePdf", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    process.env.PDF_RENDERER_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PDF_RENDERER_SECRET;
    delete process.env.PDF_RENDERER_MODE;
  });

  it("posts the signed envelope only to the same-origin Python endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    await generateFichePdf(fiche, "https://previsions-matiere.vercel.app", { mode: "vercel" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe("https://previsions-matiere.vercel.app/api/render_pdf");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect((init.headers as Record<string, string>)["X-Prevision-Pdf-Signature"]).toBe("abc123");
  });

  it("rejects a non-PDF renderer response without exposing its body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("secret stack trace", { status: 500 }));

    await expect(
      generateFichePdf(fiche, "https://example.test", { mode: "vercel" })
    ).rejects.toThrow("Impossible de générer le PDF.");
  });

  it("rejects a 200 response with the wrong content type", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("html", { status: 200, headers: { "Content-Type": "text/html" } }));

    await expect(
      generateFichePdf(fiche, "https://example.test", { mode: "vercel" })
    ).rejects.toThrow("Impossible de générer le PDF.");
  });

  it("requires the renderer secret in vercel mode", async () => {
    delete process.env.PDF_RENDERER_SECRET;
    await expect(
      generateFichePdf(fiche, "https://example.test", { mode: "vercel" })
    ).rejects.toThrow("Configuration PDF indisponible.");
  });

  it("local mode streams the payload to the local CLI and returns its stdout", async () => {
    const spawned = await generateFichePdf(fiche, "http://localhost:3002", { mode: "local" });
    expect(Buffer.isBuffer(spawned)).toBe(true);
  });
});