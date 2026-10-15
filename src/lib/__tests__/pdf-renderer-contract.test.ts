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

  it("rejects renderer input that exceeds the hard document bounds", () => {
    const oversized = structuredClone(toPdfPayload(fiche));
    oversized.rows[0].cells.matieres = "x".repeat(20_001);
    expect(() => createRendererEnvelope(oversized, "test-secret", 1)).toThrow(
      "Le document dépasse la taille autorisée."
    );
  });

  it("rejects payloads with more than 400 rows", () => {
    const manyRows = structuredClone(toPdfPayload(fiche));
    manyRows.rows = Array.from({ length: 401 }, (_, i) => ({
      ...manyRows.rows[0],
      ordre: i + 1,
    }));
    expect(() => createRendererEnvelope(manyRows, "test-secret", 1)).toThrow(
      "Le document dépasse la taille autorisée."
    );
  });

  it("does not leak database or cell identifiers into the signed body", () => {
    const { body } = createRendererEnvelope(toPdfPayload(fiche), "test-secret", 1);
    expect(body).not.toContain("cell-id");
    expect(body).not.toContain("row-db-id");
    expect(body).not.toContain("attribution");
    expect(body).not.toContain("version");
  });
});
