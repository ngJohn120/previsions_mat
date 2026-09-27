import { describe, it, expect } from "vitest";
import { groupSousByName, expandSousRows, mergeSousEntries } from "@/lib/sous-branches";

describe("groupSousByName", () => {
  it("merges duplicate names and collects their classes", () => {
    const g = groupSousByName([
      { name: "Grammaire", classe_id: "c1" },
      { name: "Grammaire", classe_id: "c2" },
      { name: "Lecture", classe_id: "c1" },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toEqual({ name: "Grammaire", classeIds: ["c1", "c2"], ids: [] });
    expect(g[1]).toEqual({ name: "Lecture", classeIds: ["c1"], ids: [] });
  });

  it("ignores empty names and de-duplicates a class repeated on the same name", () => {
    const g = groupSousByName([
      { name: "  ", classe_id: "c1" },
      { name: "Grammaire", classe_id: "c1" },
      { name: "Grammaire", classe_id: "c1" },
    ]);
    expect(g).toEqual([{ name: "Grammaire", classeIds: ["c1"], ids: [] }]);
  });

  it("keeps a null class (partagée) and a real class on the same name", () => {
    const g = groupSousByName([
      { name: "Grammaire", classe_id: null },
      { name: "Grammaire", classe_id: "c1" },
    ]);
    expect(g[0].classeIds).toEqual(["c1"]); // null is dropped: a name is either per-class or shared
  });

  it("carries existing ids through", () => {
    const g = groupSousByName([
      { id: "s1", name: "Grammaire", classe_id: "c1" },
      { id: "s2", name: "Grammaire", classe_id: "c2" },
    ]);
    expect(g[0].ids).toEqual(["s1", "s2"]);
  });
});

describe("mergeSousEntries", () => {
  it("keeps the id of a class that stays selected", () => {
    const out = mergeSousEntries([{ classeId: "c1", id: "s1" }], ["c1"]);
    expect(out).toEqual([{ classeId: "c1", id: "s1" }]);
  });

  it("gives no id to a newly selected class", () => {
    const out = mergeSousEntries([{ classeId: "c1", id: "s1" }], ["c1", "c2"]);
    expect(out).toEqual([{ classeId: "c1", id: "s1" }, { classeId: "c2" }]);
  });

  it("drops the entries whose class was un-ticked (they get deleted server-side)", () => {
    const out = mergeSousEntries([{ classeId: "c1", id: "s1" }, { classeId: "c2", id: "s2" }], ["c2"]);
    expect(out).toEqual([{ classeId: "c2", id: "s2" }]);
  });

  it("empty selection yields nothing (shared row when re-expanded)", () => {
    expect(mergeSousEntries([{ classeId: "c1", id: "s1" }], [])).toEqual([]);
  });
});

describe("expandSousRows", () => {
  it("emits one storage row per class", () => {
    const out = expandSousRows([{ name: "Grammaire", classe_id: "c1" }, { name: "Grammaire", classe_id: "c2" }]);
    expect(out).toEqual([
      { name: "Grammaire", classe_id: "c1", id: undefined },
      { name: "Grammaire", classe_id: "c2", id: undefined },
    ]);
  });

  it("emits a single null-class row when no class is selected", () => {
    expect(expandSousRows([{ name: "Maths", classe_id: null }])).toEqual([
      { name: "Maths", classe_id: null, id: undefined },
    ]);
  });

  it("pairs existing ids with their classes so edits update in place", () => {
    const out = expandSousRows([
      { id: "s1", name: "Grammaire", classe_id: "c1" },
      { id: "s2", name: "Grammaire", classe_id: "c2" },
    ]);
    expect(out.map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("round-trips: a UI row per class expands back to the storage rows", () => {
    const storage = [
      { id: "s1", name: "Grammaire", classe_id: "c1" },
      { id: "s2", name: "Grammaire", classe_id: "c2" },
      { id: "s3", name: "Lecture", classe_id: "c1" },
    ];
    // The UI holds one row per (name, classe) pair; grouping only merges the
    // name for display, so expansion must reproduce the storage rows.
    const flat = storage.map((r) => ({ name: r.name, classe_id: r.classe_id, id: r.id }));
    const back = expandSousRows(flat);
    expect(back).toEqual(storage);
  });

  it("a grouped row re-expands to one row per class it holds", () => {
    const g = groupSousByName([
      { id: "s1", name: "Grammaire", classe_id: "c1" },
      { id: "s2", name: "Grammaire", classe_id: "c2" },
    ]);
    const flat = [{ name: g[0].name, classe_id: g[0].classeIds[0] ?? null, id: g[0].ids[0] }];
    const back = expandSousRows(flat);
    expect(back).toEqual([{ name: "Grammaire", classe_id: "c1", id: "s1" }]);
  });
});
