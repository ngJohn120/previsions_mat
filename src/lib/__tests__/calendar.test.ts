import { describe, it, expect } from "vitest";
import {
  buildWeeks, generateRowsForSection, monthLabel, shortDateLabel,
  renumberRows, resequenceWeeks, shiftDateLabel,
  nextMondayAfter, mondayOfWeek, computeInsertWeek, computeInsertEventDate,
  applyInsertWeek, applyDeleteRow, applyShift, applyManualDates,
  type EditRow,
} from "@/lib/calendar";
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

// --- Calendar editing helpers (mid-year adjustments) ---

function week(id: string, num: number, label: string, mois = "Septembre"): EditRow {
  return {
    id, row_uuid: "ru-" + id, row_type: "enseignement", ordre: 0, mois,
    semaine_num: num, date_label: label, periode_label: null, evenement_label: null,
  };
}
function event(id: string, label: string, type: string, dates: string): EditRow {
  return {
    id, row_uuid: "ru-" + id, row_type: "evenement", ordre: 0, mois: null,
    semaine_num: null, date_label: dates, periode_label: label, evenement_label: type,
  };
}

describe("calendar editing helpers", () => {
  it("renumberRows reindexes ordre", () => {
    const rows = [week("a", 5, "07/09/2026 → 11/09/2026"), week("b", 9, "14/09/2026 → 18/09/2026")];
    expect(renumberRows(rows).map((r) => r.ordre)).toEqual([1, 2]);
  });

  it("resequenceWeeks renumbers weeks 1..n, events stay null", () => {
    const rows = [week("a", 5, "07/09/2026 → 11/09/2026"), event("e", "T", "evaluation", "07/09/2026 → 07/09/2026"), week("b", 9, "14/09/2026 → 18/09/2026")];
    const out = resequenceWeeks(renumberRows(rows));
    expect(out.map((r) => r.ordre)).toEqual([1, 2, 3]);
    expect(out.map((r) => r.semaine_num)).toEqual([1, null, 2]);
  });

  it("nextMondayAfter: Fri+3 and Mon+7", () => {
    expect(nextMondayAfter(new Date(2026, 8, 11)).getTime()).toBe(new Date(2026, 8, 14).getTime()); // Fri 11/09 → Mon 14/09
    expect(nextMondayAfter(new Date(2026, 8, 7)).getTime()).toBe(new Date(2026, 8, 14).getTime());  // Mon 07/09 → Mon 14/09
  });

  it("mondayOfWeek lands on the same week's Monday", () => {
    expect(mondayOfWeek(new Date(2026, 8, 9)).getTime()).toBe(new Date(2026, 8, 7).getTime());
  });

  it("applyInsertWeek: cascade +7 on rows after the new one, renumber, resequence", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026"), week("c", 3, "21/09/2026 → 25/09/2026")];
    const { dateStart, dateEnd } = computeInsertWeek(rows.find((r) => r.id === "a")!, null);
    expect(dateStart.getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(dateEnd.getTime()).toBe(new Date(2026, 8, 18).getTime());
    const out = applyInsertWeek(rows, "a", week("new", 0, "14/09/2026 → 18/09/2026"));
    expect(out.map((r) => r.id)).toEqual(["a", "new", "b", "c"]);
    expect(out.map((r) => r.date_label)).toEqual([
      "07/09/2026 → 11/09/2026",
      "14/09/2026 → 18/09/2026",
      "21/09/2026 → 25/09/2026",
      "28/09/2026 → 02/10/2026",
    ]);
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2, 3, 4]);
    expect(out[3].mois).toBe("Septembre"); // mois follows the START date (28/09)
  });

  it("applyInsertWeek at head: new week = first.start − 7, existing rows untouched", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026")];
    const { dateStart } = computeInsertWeek(null, rows[0]);
    expect(dateStart.getTime()).toBe(new Date(2026, 7, 31).getTime()); // 31/08/2026
    const out = applyInsertWeek(rows, null, week("new", 0, "31/08/2026 → 04/09/2026"));
    expect(out.map((r) => r.id)).toEqual(["new", "a"]);
    expect(out[0].date_label).toBe("31/08/2026 → 04/09/2026");
    expect(out[1].date_label).toBe("07/09/2026 → 11/09/2026"); // a does NOT move
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2]);
  });

  it("applyInsertWeek after an event anchor uses next Monday strictly after; cascade hits only rows after the new week", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), event("e", "Rentrée", "detente", "07/09/2026 → 07/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const { dateStart } = computeInsertWeek(rows.find((r) => r.id === "e")!, null);
    expect(dateStart.getTime()).toBe(new Date(2026, 8, 14).getTime()); // Mon 07/09 → next Mon 14/09
    const out = applyInsertWeek(rows, "e", week("new", 0, "14/09/2026 → 18/09/2026"));
    expect(out.map((r) => r.id)).toEqual(["a", "e", "new", "b"]);
    expect(out[2].date_label).toBe("14/09/2026 → 18/09/2026"); // new week keeps its slot
    expect(out[3].date_label).toBe("21/09/2026 → 25/09/2026"); // b shifted +7
    expect(out.map((r) => r.semaine_num)).toEqual([1, null, 2, 3]);
  });

  it("applyDeleteRow of a week closes the gap (−7 on later rows)", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026"), week("c", 3, "21/09/2026 → 25/09/2026")];
    const out = applyDeleteRow(rows, "b");
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
    expect(out[1].date_label).toBe("14/09/2026 → 18/09/2026");
    expect(out.map((r) => r.semaine_num)).toEqual([1, 2]);
  });

  it("applyDeleteRow of an event leaves dates untouched", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), event("e", "T", "evaluation", "14/09/2026 → 14/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const out = applyDeleteRow(rows, "e");
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out[1].date_label).toBe("14/09/2026 → 18/09/2026");
  });

  it("applyShift cascades and recomputes mois across year boundary", () => {
    const rows = [week("a", 1, "28/12/2026 → 01/01/2027", "Décembre"), week("b", 2, "04/01/2027 → 08/01/2027", "Janvier")];
    const out = applyShift(rows, "a", 7);
    expect(out[0].date_label).toBe("04/01/2027 → 08/01/2027");
    expect(out[0].mois).toBe("Janvier");
    expect(out[1].date_label).toBe("11/01/2027 → 15/01/2027");
  });

  it("shiftDateLabel shifts both bounds", () => {
    expect(shiftDateLabel("07/09/2026 → 11/09/2026", 2)).toBe("09/09/2026 → 13/09/2026");
    expect(shiftDateLabel("07/09/2026 → 11/09/2026", -7)).toBe("31/08/2026 → 04/09/2026");
  });

  it("computeInsertEventDate is the anchor week's Monday (single day)", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026")];
    const d = computeInsertEventDate(rows[0]);
    expect(d.getTime()).toBe(new Date(2026, 8, 7).getTime());
  });

  it("applyManualDates touches only that row, validates order, recomputes mois", () => {
    const rows = [week("a", 1, "07/09/2026 → 11/09/2026"), week("b", 2, "14/09/2026 → 18/09/2026")];
    const ok = applyManualDates(rows, "b", new Date(2026, 8, 28), new Date(2026, 9, 2));
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok[1].date_label).toBe("28/09/2026 → 02/10/2026");
      expect(ok[1].mois).toBe("Septembre");
      expect(ok[0].date_label).toBe("07/09/2026 → 11/09/2026");
    }
    const bad = applyManualDates(rows, "b", new Date(2026, 9, 5), new Date(2026, 9, 2));
    expect("error" in bad).toBe(true);
  });
});
