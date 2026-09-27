"use client";

import { useState } from "react";

/**
 * Compact class picker used by the branches modal: a button showing the current
 * selection, expanding into a checkbox list. One control for both the
 * sous-branche rows (multi-select) and the branch field (single-select), so the
 * two never drift apart.
 *
 * `multi = true`  → several classes at once, empty = partagée (toutes classes).
 * `multi = false` → at most one; picking another replaces the previous.
 */
export function ClassPicker({
  options,
  selected,
  onChange,
  multi = false,
  className = "",
  buttonClassName = "",
  title,
}: {
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  className?: string;
  buttonClassName?: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const nameById = new Map(options.map((o) => [o.id, o.name]));

  const label =
    selected.length === 0
      ? "Partagée"
      : selected.map((id) => nameById.get(id) ?? "—").join(" · ");

  function toggle(id: string) {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
    } else {
      // single-select: re-picking the current class clears it (back to partagée)
      onChange(selected.includes(id) ? [] : [id]);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-1 rounded-md border border-slate-300 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 ${buttonClassName}`}
        title={title}
      >
        <span className="truncate">{label}</span>
        <span className="text-slate-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-1.5">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-slate-300"
                checked={selected.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span>{o.name}</span>
            </label>
          ))}
          {multi && <p className="pt-1 text-[10px] text-slate-400">Aucune cochée = toutes les classes</p>}
        </div>
      )}
    </div>
  );
}
