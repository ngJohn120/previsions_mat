"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * House icon action for table rows. Row actions are ALWAYS icons: the label
 * lives in a tooltip (hover) and in `aria-label` (screen readers), so the
 * Actions column stays narrow and readable on a phone. Never use it for a
 * form submit or a panel-wide command — those keep their text.
 */
export function RowAction({
  label,
  onClick,
  children,
  tone = "default",
  disabled,
}: {
  /** Tooltip + accessible name, e.g. « Modifier ». Kept short. */
  label: string;
  onClick?: () => void;
  children: ReactNode;
  tone?: "default" | "danger" | "primary";
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={tone === "danger" ? "text-red-600 hover:text-red-700" : undefined}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
