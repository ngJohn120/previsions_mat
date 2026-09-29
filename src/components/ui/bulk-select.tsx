"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Trash2Icon, XIcon } from "lucide-react";

/**
 * Bulk selection for a list of rows: a checkbox in the first column and a
 * delete action that only APPEARS once something is selected. The action calls
 * `onDelete(ids)` with the current selection; the parent owns the confirmation
 * and the actual delete (a bulk action must never run unconfirmed).
 */
export function BulkSelectHeader({
  selected,
  total,
  label,
  onToggleAll,
}: {
  selected: string[];
  total: number;
  label: string;
  onToggleAll: (next: boolean) => void;
}) {
  const all = total > 0 && selected.length === total;
  return (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 rounded border-slate-300"
      checked={all}
      aria-label={all ? `Tout désélectionner (${label})` : `Tout sélectionner (${label})`}
      title={all ? `Tout désélectionner (${label})` : `Tout sélectionner (${label})`}
      onChange={(e) => onToggleAll(e.target.checked)}
    />
  );
}

export function BulkDeleteAction({
  count,
  onDelete,
  onClear,
  disabled,
  what = "attribution",
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** What is being deleted — « attribution » (table) or « classe » (cards). */
  what?: "attribution" | "classe";
}) {
  // Dynamic: nothing selected ⇒ no button at all (no disabled ghost).
  if (count === 0) return null;
  const plural = count > 1;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{count} sélectionné{plural ? "s" : ""}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={disabled}
              aria-label={`Supprimer la sélection (${count})`}
            />
          }
        >
          <Trash2Icon className="text-red-600" />
        </TooltipTrigger>
        <TooltipContent>
          {`Supprimer ${count} ${what}${plural ? "s" : ""} et leur${plural ? "s" : ""} fiche${plural ? "s" : ""}`}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={onClear} aria-label="Annuler la sélection" />}>
          <XIcon />
        </TooltipTrigger>
        <TooltipContent>Annuler la sélection</TooltipContent>
      </Tooltip>
    </div>
  );
}
