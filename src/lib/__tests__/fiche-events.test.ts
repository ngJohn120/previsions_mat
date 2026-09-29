import { describe, it, expect } from "vitest";
import { eventForWeek, eventLabel, eventLabelInWeek, monthBlocks, parseRange, weeksWithEvents } from "@/lib/fiche-events";
import type { FicheRow } from "@/lib/fiche-types";

function week(n: number, start: string, end: string, mois = "Septembre"): FicheRow {
  return {
    id: `w${n}`, fiche_id: "f", row_uuid: `r${n}`, ordre: n, row_type: "enseignement",
    mois, semaine_num: n, date_label: `${start} → ${end}`, periode_label: null,
    evenement_label: null, cells: {},
  };
}

function event(label: string, start: string, end: string, type = "vacances"): FicheRow {
  return {
    id: `e-${label}`, fiche_id: "f", row_uuid: `re-${label}`, ordre: 99, row_type: "evenement",
    mois: null, semaine_num: null, date_label: `${start} → ${end}`, periode_label: label,
    evenement_label: type, cells: {},
  };
}

describe("parseRange", () => {
  it("parses a DD/MM/YYYY range", () => {
    const r = parseRange("01/09/2026 → 04/09/2026");
    expect(r?.start.getFullYear()).toBe(2026);
    expect(r?.start.getMonth()).toBe(8);
    expect(r?.start.getDate()).toBe(1);
    expect(r?.end.getDate()).toBe(4);
  });
  it("returns null for null/garbage", () => {
    expect(parseRange(null)).toBeNull();
    expect(parseRange("Pas une date")).toBeNull();
  });
});

describe("weeksWithEvents — paper-faithful placement", () => {
  it("prints the event on the FIRST week it covers and marks the later weeks", () => {
    // An event spanning weeks 2 and 3.
    const ev = event("Vacances de Noël", "07/09/2026", "18/09/2026");
    const rows = [week(1, "31/08/2026", "04/09/2026"), week(2, "07/09/2026", "11/09/2026"), week(3, "14/09/2026", "18/09/2026")];
    const out = weeksWithEvents([...rows, ev]);
    expect(out).toHaveLength(3); // the event is NOT a row of its own
    expect(out[0].event).toBeNull();
    // first covered week: the event is printed in full
    expect(out[1].event?.periode_label).toBe("Vacances de Noël");
    expect(out[1].continues).toBe(false);
    // the following week of the span is MARKED as belonging to it, not blank
    expect(out[2].event?.periode_label).toBe("Vacances de Noël");
    expect(out[2].continues).toBe(true);
  });

  it("marks every week of a multi-week span, none left as ordinary teaching", () => {
    // Vacances de Noël 23/12 → 09/01 covers weeks 17, 18 and 19.
    const ev = event("Vacances de Noël", "23/12/2026", "09/01/2027");
    const rows = [
      week(16, "14/12/2026", "18/12/2026"),
      week(17, "21/12/2026", "25/12/2026"),
      week(18, "28/12/2026", "01/01/2027"),
      week(19, "04/01/2027", "08/01/2027"),
      week(20, "11/01/2027", "15/01/2027"),
    ];
    const out = weeksWithEvents([...rows, ev]);
    expect(out.map((w) => w.continues)).toEqual([false, false, true, true, false]);
    expect(out[1].event?.periode_label).toBe("Vacances de Noël");
    expect(out[3].event?.periode_label).toBe("Vacances de Noël");
    expect(out[4].event).toBeNull();
  });

  it("an event covering one week lands on that week", () => {
    const ev = event("1re évaluation", "07/09/2026", "11/09/2026", "evaluation");
    const out = weeksWithEvents([week(1, "31/08/2026", "04/09/2026"), week(2, "07/09/2026", "11/09/2026"), ev]);
    expect(out[0].event).toBeNull();
    expect(out[1].event?.periode_label).toBe("1re évaluation");
  });

  it("keeps only teaching rows in order", () => {
    const ev = event("X", "01/09/2026", "30/09/2026");
    const out = weeksWithEvents([week(1, "31/08/2026", "04/09/2026"), week(2, "07/09/2026", "11/09/2026"), ev]);
    expect(out.map((w) => w.row.semaine_num)).toEqual([1, 2]);
  });

  it("no event ⇒ every week has none", () => {
    const out = weeksWithEvents([week(1, "31/08/2026", "04/09/2026"), week(2, "07/09/2026", "11/09/2026")]);
    expect(out.every((w) => w.event === null)).toBe(true);
  });
});

describe("eventForWeek", () => {
  it("ignores a week with no date range", () => {
    const w = { ...week(1, "a", "b"), date_label: null };
    expect(eventForWeek([event("E", "01/09/2026", "05/09/2026")], w)).toBeNull();
  });
  it("ignores a week without a number", () => {
    const w = { ...week(1, "31/08/2026", "04/09/2026"), semaine_num: null };
    expect(eventForWeek([event("E", "31/08/2026", "04/09/2026")], w)).toBeNull();
  });
});

describe("monthBlocks", () => {
  it("labels the first row of a month and spans the rest", () => {
    const rows = [
      week(1, "31/08/2026", "04/09/2026", "Août"),
      week(2, "07/09/2026", "11/09/2026", "Septembre"),
      week(3, "14/09/2026", "18/09/2026", "Septembre"),
      week(4, "21/09/2026", "25/09/2026", "Septembre"),
    ];
    const blocks = monthBlocks(rows);
    expect(blocks.map((b) => b.label)).toEqual(["Août", "Septembre", null, null]);
    expect(blocks.map((b) => b.rowspan)).toEqual([1, 3, 1, 1]);
  });
});

describe("eventLabelInWeek", () => {
  it("appends the end date when the event stops inside the school week", () => {
    // week 04/01 → 08/01, event ends Wednesday 06/01
    const w = week(19, "04/01/2027", "08/01/2027", "Janvier");
    const ev = event("Vacances de Noël", "23/12/2026", "06/01/2027");
    expect(eventLabelInWeek(ev, w, true)).toBe("Vacances de Noël (suite) (06/01/2027)");
  });
  it("adds nothing when the event already ends on the week's last day", () => {
    const w = week(19, "04/01/2027", "08/01/2027", "Janvier");
    const ev = event("Vacances de Noël", "23/12/2026", "08/01/2027");
    expect(eventLabelInWeek(ev, w, true)).toBe("Vacances de Noël (suite)");
    expect(eventLabelInWeek(ev, w, false)).toBe("Vacances de Noël");
  });
  it("keeps the plain label when a date cannot be parsed", () => {
    const w = week(1, "31/08/2026", "04/09/2026");
    const ev = { ...event("X", "a", "b"), date_label: "n'importe quoi" };
    expect(eventLabelInWeek(ev, w, false)).toBe("X");
  });
});

describe("eventLabel", () => {
  it("prefers the period name, falls back to the date range", () => {
    expect(eventLabel(event("Vacances", "01/09/2026", "05/09/2026"))).toBe("Vacances");
    const noLabel = { ...event("", "01/09/2026", "05/09/2026"), periode_label: null };
    expect(eventLabel(noLabel)).toBe("01/09/2026 → 05/09/2026");
  });
});
