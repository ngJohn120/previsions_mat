"use client";

import { useMemo, useRef, useState } from "react";
import { Cell } from "@/components/editor/cell";
import { cn } from "@/lib/utils";
import type { FicheRow } from "@/lib/fiche-types";
import {
  eventLabelInWeek, eventRowClass, eventTextClass, weeksWithEvents,
} from "@/lib/fiche-events";

const SEC_COL_META: { key: string; label: string; required: boolean; className?: string; narrow?: boolean }[] = [
  { key: "matieres", label: "Matières prévues", required: true, className: "min-w-[300px]" },
  { key: "heure", label: "Heure", required: true, className: "min-w-[64px]", narrow: true },
  { key: "mv", label: "M.V. (Matières vues)", required: false, className: "min-w-[300px]" },
  { key: "obs", label: "Obs.", required: false, className: "min-w-[130px]" },
];

// Column order for display: N | Semaines | Heure | Matières | M.V. | Obs.
const DISPLAY_ORDER = ["heure", "matieres", "mv", "obs"] as const;
const COL_SPAN = DISPLAY_ORDER.length + 2; // + num + week

/**
 * Secondary grid: week rows with N + date range, Heure/Matières prévues/
 * M.V./Obs. cells, gray period separator bands. Multi-week events follow the
 * paper — shared with the primary grid and the PDF: an event is printed in
 * full on the FIRST week it covers and the following weeks of its span are
 * marked « (suite) » (nothing editable there), never an ordinary week.
 */
export function SecondaryGrid({
  rows,
  editable,
  onCellsChange,
  onCellCommit,
}: {
  rows: FicheRow[];
  editable: boolean;
  /** Called whenever a cell value changes locally (for live completeness). */
  onCellsChange?: (values: Record<string, string>) => void;
  /** Called debounced after an edit for persistence. */
  onCellCommit?: (cellId: string, value: string, version: number) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) {
      for (const cell of Object.values(r.cells)) init[cell.id] = cell.value;
    }
    return init;
  });

  // Keep a ref mirror so handleCellChange can read the latest values without
  // calling setState inside another setState updater (which React forbids).
  const valuesRef = useRef(values);

  function handleCellChange(cellId: string, value: string) {
    const next = { ...valuesRef.current, [cellId]: value };
    valuesRef.current = next;
    setValues(next);
    onCellsChange?.(next);
  }

  // Teaching weeks, each with the event printed on it (shared with the primary
  // grid + PDF), with period separators where the period label changes.
  const weeks = useMemo(() => weeksWithEvents(rows), [rows]);
  const display = useMemo(() => {
    type Disp = { kind: "teaching"; w: (typeof weeks)[number] } | { kind: "period"; label: string };
    const out: Disp[] = [];
    let lastPeriod: string | null = null;
    for (const w of weeks) {
      const period = w.row.periode_label;
      if (period && period !== lastPeriod) {
        out.push({ kind: "period", label: period.toUpperCase() });
        lastPeriod = period;
      }
      out.push({ kind: "teaching", w });
    }
    return out;
  }, [weeks]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1120px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-[44px] border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase">N</th>
            <th className="w-[152px] border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase">Semaines</th>
            {DISPLAY_ORDER.map((key) => {
              const meta = SEC_COL_META.find((c) => c.key === key)!;
              return (
                <th
                  key={key}
                  className={cn(
                    "border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase",
                    meta.className
                  )}
                >
                  {meta.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {display.map((d, i) => {
            if (d.kind === "period") {
              return (
                <tr key={`period-${i}-${d.label}`} className="bg-slate-100">
                  <td colSpan={COL_SPAN} className="border border-slate-300/70 px-3 py-2 text-center text-xs font-extrabold tracking-wide text-slate-700 uppercase">
                    {d.label}
                  </td>
                </tr>
              );
            }
            const w = d.w;
            const row = w.row;
            const ev = w.event;
            return (
              <tr key={row.id} className={ev ? eventRowClass(ev.evenement_label) : undefined}>
                <td className="border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle font-semibold text-slate-700">
                  {row.semaine_num ?? ""}
                </td>
                <td className="whitespace-nowrap border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle text-[11px] text-slate-500">
                  {row.date_label ?? ""}
                </td>
                {DISPLAY_ORDER.map((key, ci) => {
                  // An event week carries no teaching: the event name spans the
                  // teaching area, centered, and nothing is editable there —
                  // the paper's layout, same as the primary grid.
                  if (ev && ci === 0) {
                    return (
                      <td
                        key={key}
                        colSpan={DISPLAY_ORDER.length}
                        className="h-[46px] border border-slate-200 px-2 py-1.5 align-middle"
                      >
                        <span
                          className={cn(
                            "block text-center text-[12.5px] leading-snug font-bold tracking-wide uppercase",
                            eventTextClass(ev.evenement_label),
                            w.continues && "opacity-80"
                          )}
                          title={ev.date_label ?? undefined}
                        >
                          {eventLabelInWeek(ev, row, w.continues)}
                        </span>
                      </td>
                    );
                  }
                  if (ev) {
                    // remaining teaching columns of the event row are covered by
                    // the colspan above
                    return null;
                  }
                  const meta = SEC_COL_META.find((c) => c.key === key)!;
                  const cell = row.cells[key];
                  const value = cell ? values[cell.id] ?? cell.value : "";
                  return (
                    <td
                      key={key}
                      className={cn(
                        "h-[46px] border border-slate-200 p-0 align-top",
                        meta.className,
                        meta.narrow && "text-center"
                      )}
                    >
                      {cell ? (
                        <Cell
                          cellId={cell.id}
                          value={value}
                          version={cell.version}
                          colKey={key}
                          required={meta.required}
                          editable={editable}
                          onChange={(v) => handleCellChange(cell.id, v)}
                          onCommit={onCellCommit}
                        />
                      ) : (
                        <div className="px-2 py-1.5 text-slate-300">—</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
