"use client";

import { useEffect, useRef, useState } from "react";
import { saveCellValue } from "@/app/(app)/fiche/actions";
import { cn } from "@/lib/utils";

/**
 * Single editable cell in a fiche grid.
 *
 * Online-first for now (P3): each edit debounces and persists through the
 * set_cell_value RPC with optimistic UI. Phase 4 swaps persistence for
 * IndexedDB + outbox (local-first) while keeping this interface.
 */
export function Cell({
  cellId,
  value,
  version,
  colKey,
  required,
  editable,
  onChange,
}: {
  cellId: string;
  value: string;
  version: number;
  colKey: string;
  required: boolean;
  editable: boolean;
  /** Optional callback fired after a local (optimistic) change. */
  onChange?: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  // Sync when server value changes from outside (revalidation/pull)
  useEffect(() => {
    setText(value);
  }, [value]);

  const missing = required && editable && text.trim() === "";

  function handleChange(next: string) {
    setText(next);
    onChange?.(next);
    setSaveState("saving");

    if (timer.current) clearTimeout(timer.current);
    // Debounce 600ms then persist
    timer.current = setTimeout(async () => {
      const res = await saveCellValue({ cellId, value: next, expectedVersion: version });
      if (res.error) {
        setSaveState("error");
      } else {
        setSaveState("saved");
      }
      // reset to idle after showing "saved"
      setTimeout(() => setSaveState("idle"), 1200);
    }, 600);
  }

  // Avoid saving the initial render value
  useEffect(() => {
    first.current = false;
  }, []);

  return (
    <div className="group relative h-full">
      {editable ? (
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          disabled={!editable}
          placeholder={required ? "…" : ""}
          rows={1}
          className={cn(
            "cell-input w-full resize-none bg-transparent px-2 py-1.5 text-[13px] leading-snug outline-none",
            "focus:bg-amber-50/60 focus:shadow-[inset_0_0_0_2px_#93c5fd]",
            missing && "shadow-[inset_3px_0_0_0_#e5b9b9]",
            saveState === "error" && "shadow-[inset_3px_0_0_0_#ef4444]"
          )}
          data-col={colKey}
        />
      ) : (
        <div className="min-h-[34px] whitespace-pre-wrap px-2 py-1.5 text-[13px] leading-snug text-slate-800">
          {text || <span className="text-slate-300">—</span>}
        </div>
      )}
      {editable && (
        <span className="pointer-events-none absolute right-1 bottom-0 text-[9px] text-slate-300 group-focus-within:hidden">
          {saveState === "saved" ? "✓" : saveState === "error" ? "!" : ""}
        </span>
      )}
    </div>
  );
}
