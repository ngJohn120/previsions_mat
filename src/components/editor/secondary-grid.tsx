"use client";

import { useMemo, useRef, useState } from "react";
import { Cell } from "@/components/editor/cell";
import { cn } from "@/lib/utils";
import type { FicheRow } from "@/lib/fiche-types";

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
 * M.V./Obs. cells, gray period separator bands and golden event bands.
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

  // Insert period-separator pseudo-rows whenever the period label changes
  // between consecutive teaching rows, and render events as bands.
  const display = useMemo(() => {
    type Disp =
      | { kind: "teaching"; row: FicheRow }
      | { kind: "period"; label: string }
      | { kind: "event"; row: FicheRow };
    const out: Disp[] = [];
    let lastPeriod: string | null = null;
    for (const r of rows) {
      if (r.row_type === "evenement") {
        out.push({ kind: "event", row: r });
        continue;
      }
      const period = r.periode_label;
      if (period && period !== lastPeriod) {
        out.push({ kind: "period", label: period.toUpperCase() });
        lastPeriod = period;
      }
      out.push({ kind: "teaching", row: r });
    }
    return out;
  }, [rows]);

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
            if (d.kind === "event") {
              return (
                <tr key={d.row.id} className={bandClass(d.row.evenement_label)}>
                  <td colSpan={COL_SPAN} className="border border-amber-200/70 px-3 py-2 text-center text-[11.5px] font-bold tracking-wide text-amber-800 uppercase">
                    {d.row.periode_label ?? d.row.date_label ?? "Événement"}
                  </td>
                </tr>
              );
            }
            const row = d.row;
            return (
              <tr key={row.id}>
                <td className="border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle font-semibold text-slate-700">
                  {row.semaine_num ?? ""}
                </td>
                <td className="whitespace-nowrap border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle text-[11px] text-slate-500">
                  {row.date_label ?? ""}
                </td>
                {DISPLAY_ORDER.map((key) => {
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

function bandClass(type: string | null): string {
  if (type === "evaluation" || type === "examen") {
    return "bg-purple-50 text-purple-700 [&>td]:!border-purple-200";
  }
  return "bg-amber-50 text-amber-800 [&>td]:!border-amber-200/70";
}
