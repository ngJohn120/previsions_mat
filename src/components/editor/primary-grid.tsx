"use client";

import { useMemo, useRef, useState } from "react";
import { Cell } from "@/components/editor/cell";
import { cn } from "@/lib/utils";
import type { FicheRow } from "@/lib/fiche-types";
import {
  eventLabelInWeek, eventRowClass, eventTextClass, monthBlocks, weeksWithEvents,
} from "@/lib/fiche-events";

const PRIMARY_COL_META: { key: string; label: string; required: boolean; className?: string }[] = [
  { key: "matieres", label: "Matières à enseigner", required: true, className: "min-w-[250px]" },
  { key: "ref", label: "Réf.", required: true, className: "min-w-[280px]" },
  { key: "intention", label: "Intention", required: true, className: "min-w-[260px]" },
  { key: "obs", label: "Obs.", required: false, className: "min-w-[120px]" },
];

/**
 * Primary grid: month-grouped rows (month header with rowspan over the
 * consecutive teaching rows of that month), a week column (number + range),
 * editable teaching cells. An event week shows only its name, centered
 * across the teaching area (nothing is editable there) — the paper's layout.
 *
 * Paper-faithful events: on the official document an event is written on the
 * row of the FIRST week it covers (in its own column), and the following weeks
 * of the span stay normal teaching rows. Event rows carry no `semaine_num`, so
 * each one is attached at render time to the first teaching week it overlaps —
 * no data migration needed.
 */
export function PrimaryGrid({
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
  // cellId -> current (possibly optimistic) value
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

  // Teaching rows, each with the event printed on it (shared with the PDF), and
  // the month blocks those rows form.
  const weeks = useMemo(() => weeksWithEvents(rows), [rows]);
  const months = useMemo(
    () => monthBlocks(weeks.map((w) => w.row)),
    [weeks]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="w-[110px] border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase">
              Mois
            </th>
            <th className="w-[176px] border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase">
              Semaine — Date
            </th>
            {PRIMARY_COL_META.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "border-b-2 border-r border-slate-200 bg-slate-100 px-2 py-2 text-center text-[10.5px] font-bold tracking-wide text-slate-500 uppercase",
                  c.className
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => {
            const ev = w.event;
            const month = months[i];
            return (
              <tr key={w.row.id} className={ev ? eventRowClass(ev.evenement_label) : undefined}>
                {month.label !== null && (
                  <td
                    rowSpan={month.rowspan}
                    className="w-[110px] border border-slate-200 bg-slate-100 px-2 py-2 text-center align-middle text-xs font-bold text-slate-600"
                  >
                    {month.label}
                  </td>
                )}
                <td className="whitespace-nowrap border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle">
                  <span className="block text-sm font-bold text-slate-800">
                    {w.row.semaine_num ?? ""}
                  </span>
                  <span className="block text-[11px] text-slate-500">{w.row.date_label ?? ""}</span>
                </td>
                {PRIMARY_COL_META.map((col, ci) => {
                  // An event week carries no teaching: the event name spans the
                  // teaching area, centered, and nothing is editable there.
                  if (ev && ci === 0) {
                    return (
                      <td
                        key={col.key}
                        colSpan={PRIMARY_COL_META.length}
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
                          {eventLabelInWeek(ev, w.row, w.continues)}
                        </span>
                      </td>
                    );
                  }
                  if (ev) {
                    // remaining teaching columns of the event row are covered by
                    // the colspan above
                    return null;
                  }
                  const cell = w.row.cells[col.key];
                  const value = cell ? values[cell.id] ?? cell.value : "";
                  return (
                    <td
                      key={col.key}
                      className={cn("h-[46px] border border-slate-200 p-0 align-top", col.className)}
                    >
                      {cell ? (
                        <Cell
                          cellId={cell.id}
                          value={value}
                          version={cell.version}
                          colKey={col.key}
                          required={col.required}
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

