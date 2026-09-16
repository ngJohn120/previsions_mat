import { beforeEach, describe, expect, it, vi } from "vitest";

// The component module needs only GlobalWorkerOptions + getDocument at import
// time (the pdfPreviewError helper is the sole surface under test; React
// machinery never renders here). Importing the real pdf.mjs would require DOM
// globals (DOMMatrix) unavailable in node, so mock it fully.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs", () => ({}));

import { pdfPreviewError } from "@/components/print/pdf-preview";

describe("pdfPreviewError", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("maps a non-OK protected-route result to the approved French error", () => {
    expect(pdfPreviewError(new Response(null, { status: 401 }))).toBe(
      "Impossible de préparer l’aperçu. Réessayez dans un instant."
    );
    expect(pdfPreviewError(new Response(null, { status: 500 }))).toBe(
      "Impossible de préparer l’aperçu. Réessayez dans un instant."
    );
  });

  it("maps a network failure (fetch throw) to the same approved message", () => {
    expect(pdfPreviewError(new TypeError("Failed to fetch"))).toBe(
      "Impossible de préparer l’aperçu. Réessayez dans un instant."
    );
  });
});