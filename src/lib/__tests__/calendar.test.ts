import { describe, it, expect } from "vitest";
import { buildWeeks, generateRowsForSection, monthLabel, shortDateLabel } from "@/lib/calendar";

describe("buildWeeks", () => {
  it("returns weeks starting ON startDate (partial first week), sequential numbering", () => {
    // Sept 1 2026 is a Tuesday; first week runs 01→04/09 (Tue–Fri)
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 8, 30));
    expect(weeks.length).toBe(5);
    expect(weeks[0].start.getDate()).toBe(1);
    expect(weeks[0].semaine_num).toBe(1);
    expect(weeks[4].semaine_num).toBe(5);
  });

  it("handles a multi-month range with sequential numbering", () => {
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 11, 31));
    // ~17-18 weeks Sep-Dec
    expect(weeks.length).toBeGreaterThan(15);
    weeks.forEach((w, i) => expect(w.semaine_num).toBe(i + 1));
  });

  it("labels month from the week's start date", () => {
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 8, 15));
    expect(weeks[0].mois).toBe("Septembre");
  });
});

describe("generateRowsForSection", () => {
  it("produces teaching rows with no events", () => {
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 8, 14));
    const rows = generateRowsForSection(weeks);
    expect(rows.length).toBe(weeks.length);
    expect(rows[0].row_type).toBe("enseignement");
    expect(rows[0].mois).toBe("Septembre");
    expect(rows[0].semaine_num).toBe(1);
    expect(rows[0].date_label).toContain("2026");
  });

  it("inserts event band rows before the following teaching week", () => {
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 8, 28)); // ~4 weeks
    const rows = generateRowsForSection(weeks, [
      { label: "Vacances de Noël", type: "vacances", start: new Date(2026, 8, 10), end: new Date(2026, 8, 14) },
    ]);
    // Expect a 'vacances' event row inserted (before week 2 or wherever it falls)
    const eventRows = rows.filter((r) => r.row_type === "evenement");
    expect(eventRows.length).toBe(1);
    expect(eventRows[0].evenement_label).toBe("vacances");
    expect(eventRows[0].periode_label).toBe("Vacances de Noël");
    expect(eventRows[0].semaine_num).toBeNull();
    // Total = teaching weeks + event
    expect(rows.length).toBe(weeks.length + 1);
  });

  it("sorts multiple events by start date", () => {
    const weeks = buildWeeks(new Date(2026, 8, 1), new Date(2026, 8, 28));
    const rows = generateRowsForSection(weeks, [
      { label: "Fin", type: "vacances", start: new Date(2026, 8, 20), end: new Date(2026, 8, 22) },
      { label: "Début", type: "revision", start: new Date(2026, 8, 3), end: new Date(2026, 8, 5) },
    ]);
    const events = rows.filter((r) => r.row_type === "evenement");
    expect(events[0].periode_label).toBe("Début");
    expect(events[1].periode_label).toBe("Fin");
  });
});

describe("date helpers", () => {
  it("monthLabel returns French month", () => {
    expect(monthLabel(new Date(2026, 0, 5))).toBe("Janvier");
    expect(monthLabel(new Date(2026, 11, 5))).toBe("Décembre");
  });

  it("shortDateLabel formats range", () => {
    expect(shortDateLabel(new Date(2026, 8, 1), new Date(2026, 8, 4))).toBe("01 → 04/09/2026");
  });
});
