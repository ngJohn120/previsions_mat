"use client";

import { useMemo, useState } from "react";
import { Cell } from "@/components/editor/cell";
import { cn } from "@/lib/utils";
import type { FicheRow } from "@/lib/fiche-types";

const PRIMARY_COL_META: { key: string; label: string; required: boolean; className?: string }[] = [
  { key: "matieres", label: "Matières à enseigner", required: true, className: "min-w-[250px]" },
  { key: "ref", label: "Réf.", required: true, className: "min-w-[280px]" },
  { key: "intention", label: "Intention", required: true, className: "min-w-[260px]" },
  { key: "obs", label: "Obs.", required: false, className: "min-w-[120px]" },
];

const COL_SPAN = PRIMARY_COL_META.length + 2; // + mois + semaine

/**
 * Primary grid: month-grouped rows (month header with rowspan over the
 * consecutive teaching rows of that month), a week column (number + range),
 * editable teaching cells, and full-width event bands.
 */
export function PrimaryGrid({
  rows,
  editable,
  onCellsChange,
}: {
  rows: FicheRow[];
  editable: boolean;
  onCellsChange?: (values: Record<string, string>) => void;
}) {
  // cellId -> current (possibly optimistic) value
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) {
      for (const cell of Object.values(r.cells)) init[cell.id] = cell.value;
    }
    return init;
  });

  function handleCellChange(cellId: string, value: string) {
    setValues((prev) => {
      const next = { ...prev, [cellId]: value };
      onCellsChange?.(next);
      return next;
    });
  }

  // Compute display rows: teaching rows carry a monthHeader + rowspan when a
  // new month starts; event rows are standalone full-width bands.
  const display = useMemo(() => {
    type Disp =
      | { kind: "teaching"; row: FicheRow; monthLabel: string | null; monthRowspan: number }
      | { kind: "event"; row: FicheRow };
    const out: Disp[] = [];
    const teaching = rows.filter((r) => r.row_type === "enseignement");
    // Build consecutive same-month run lengths for teaching rows
    let i = 0;
    for (const r of rows) {
      if (r.row_type === "evenement") {
        out.push({ kind: "event", row: r });
        continue;
      }
      // teaching: decide whether it begins a new month block
      const prev = teaching[i - 1];
      const isNewMonth = !prev || prev.mois !== r.mois;
      let rowspan = 1;
      if (isNewMonth) {
        // count consecutive teaching rows sharing this mois
        let j = i;
        while (j + 1 < teaching.length && teaching[j + 1].mois === r.mois) j++;
        rowspan = j - i + 1;
      }
      out.push({
        kind: "teaching",
        row: r,
        monthLabel: isNewMonth ? r.mois : null,
        monthRowspan: rowspan,
      });
      i++;
    }
    return out;
  }, [rows]);

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
          {display.map((d) =>
            d.kind === "event" ? (
              <tr key={d.row.id} className={bandClass(d.row.evenement_label)}>
                <td colSpan={COL_SPAN} className="border border-amber-200/70 px-3 py-2 text-center text-[11.5px] font-bold tracking-wide text-amber-800 uppercase">
                  {d.row.periode_label ?? d.row.date_label ?? "Événement"}
                </td>
              </tr>
            ) : (
              <tr key={d.row.id}>
                {d.monthLabel !== null && (
                  <td
                    rowSpan={d.monthRowspan}
                    className="w-[110px] border border-slate-200 bg-slate-100 px-2 py-2 text-center align-middle text-xs font-bold text-slate-600"
                  >
                    {d.monthLabel}
                  </td>
                )}
                <td className="whitespace-nowrap border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-center align-middle">
                  <span className="block text-sm font-bold text-slate-800">
                    {d.row.semaine_num ?? ""}
                  </span>
                  <span className="block text-[11px] text-slate-500">{d.row.date_label ?? ""}</span>
                </td>
                {PRIMARY_COL_META.map((col) => {
                  const cell = d.row.cells[col.key];
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
                        />
                      ) : (
                        <div className="px-2 py-1.5 text-slate-300">—</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            )
          )}
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
