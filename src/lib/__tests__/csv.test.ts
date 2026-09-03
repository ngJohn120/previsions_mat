import { describe, it, expect } from "vitest";
import { parseCsv, validateUsersCsv, validateClassesCsv, validateBranchesCsv, validateAttributionsCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    const { rows } = parseCsv("a,b\n1,2\n3,4");
    expect(rows).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("handles quoted commas and CRLF", () => {
    const { rows } = parseCsv('name,desc\r\n"Smith, John","Hello, world"\r\n');
    expect(rows).toEqual([["name", "desc"], ["Smith, John", "Hello, world"]]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const { rows } = parseCsv('a,b\n"say ""hi""",2');
    expect(rows[1]).toEqual(['say "hi"', "2"]);
  });

  it("reports unterminated quote as an error", () => {
    const { rows, errors } = parseCsv('a\n"unterminated');
    expect(errors.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("validateUsersCsv", () => {
  it("accepts valid rows and rejects invalid", () => {
    const { data, errors } = validateUsersCsv([
      ["new@siloe.edu", "New Prof", "", "enseignant", "secondaire"],
      ["bad-email", "X", "", "enseignant", "secondaire"],
      ["x@siloe.edu", "", "", "admin_primaire", "primaire"],
    ]);
    expect(data).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
});

describe("validateClassesCsv", () => {
  it("accepts valid rows and rejects missing level", () => {
    const { data, errors } = validateClassesCsv([
      ["5e A", "5e", "1", ""],
      ["6e B", "", "2", ""],
    ]);
    expect(data).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe("validateBranchesCsv", () => {
  it("splits sections and sous-branches", () => {
    const { data, errors } = validateBranchesCsv([
      ["Sciences", "primaire,secondaire", "Physique,Chimie"],
    ]);
    expect(errors).toHaveLength(0);
    expect(data[0].sections).toEqual(["primaire", "secondaire"]);
    expect(data[0].sous_branches).toEqual(["Physique", "Chimie"]);
  });

  it("rejects bad section", () => {
    const { errors } = validateBranchesCsv([["X", "maternelle", ""]]);
    expect(errors).toHaveLength(1);
  });
});

describe("validateAttributionsCsv", () => {
  it("accepts valid attribution", () => {
    const { data, errors } = validateAttributionsCsv([
      ["secondaire", "3e", "Mathématiques", "", "m.kazadi@siloe.edu"],
    ]);
    expect(errors).toHaveLength(0);
    expect(data[0]).toMatchObject({ section: "secondaire", classe: "3e", branche: "Mathématiques", enseignant_email: "m.kazadi@siloe.edu" });
  });
});
