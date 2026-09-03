"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Single editable cell in a fiche grid.
 *
 * Local-first: edits update the parent immediately (optimistic). After a
 * debounce, `onCommit` is called with (cellId, value, version) so the parent
 * can persist via IndexedDB + outbox (Phase 4) or server RPC (fallback).
 */
export function Cell({
  cellId,
  value,
  version,
  colKey,
  required,
  editable,
  onChange,
  onCommit,
}: {
  cellId: string;
  value: string;
  version: number;
  colKey: string;
  required: boolean;
  editable: boolean;
  onChange?: (value: string) => void;
  /** Persistence callback — invoked debounced after an edit. */
  onCommit?: (cellId: string, value: string, version: number) => void;
}) {
  const [text, setText] = useState(value);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    timer.current = setTimeout(async () => {
      try {
        await onCommit?.(cellId, next, version);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
      setTimeout(() => setSaveState("idle"), 1200);
    }, 500);
  }

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
