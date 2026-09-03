import { describe, it, expect } from "vitest";
import { mergeRows, opIdFor } from "@/lib/sync/engine";
import type { FicheRow } from "@/lib/fiche-types";

function mkRow(id: string, rowUuid: string, over: Partial<FicheRow> = {}): FicheRow {
  return {
    id,
    fiche_id: "f1",
    row_uuid: rowUuid,
    ordre: 1,
    row_type: "enseignement",
    mois: "Septembre",
    semaine_num: 1,
    date_label: "01 → 04/09",
    periode_label: null,
    evenement_label: null,
    cells: {},
    ...over,
  };
}

describe("mergeRows", () => {
  it("keeps identical cells as server value", () => {
    const local = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "leçon", version: 1 } },
    });
    const server = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "leçon", version: 1 } },
    });
    const { rows, conflicts } = mergeRows([local], [server]);
    expect(conflicts).toHaveLength(0);
    expect(rows[0].cells.matieres.value).toBe("leçon");
  });

  it("takes server value when server version is newer and no local divergence", () => {
    const local = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "old", version: 1 } },
    });
    const server = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "server-new", version: 2 } },
    });
    const { rows, conflicts } = mergeRows([local], [server]);
    expect(conflicts).toHaveLength(0);
    expect(rows[0].cells.matieres.value).toBe("server-new");
  });

  it("flags a conflict when local and server both edited and local version is ahead", () => {
    const local = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "local", version: 3 } },
    });
    const server = mkRow("r1", "ru1", {
      cells: { matieres: { id: "c1", value: "server", version: 2 } },
    });
    const { rows, conflicts } = mergeRows([local], [server]);
    expect(conflicts).toEqual([
      { rowUuid: "ru1", cellKey: "matieres", localValue: "local", serverValue: "server" },
    ]);
    // local kept optimistically
    expect(rows[0].cells.matieres.value).toBe("local");
  });

  it("adds rows present on server but missing locally", () => {
    const local = mkRow("r1", "ru1", {});
    const server = [
      mkRow("r1", "ru1", {}),
      mkRow("r2", "ru2", { cells: { heure: { id: "c9", value: "4h", version: 1 } } }),
    ];
    const { rows } = mergeRows([local], server);
    expect(rows).toHaveLength(2);
    expect(rows[1].id).toBe("r2");
  });
});

describe("opIdFor", () => {
  it("is deterministic", () => {
    expect(opIdFor("set_cell", "abc123value")).toBe(opIdFor("set_cell", "abc123value"));
    expect(opIdFor("set_cell", "a")).not.toBe(opIdFor("set_cell", "b"));
  });
});
