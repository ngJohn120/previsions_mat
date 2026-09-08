"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

function Tooltip({
  children,
  ...props
}: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>
}

function TooltipTrigger({
  children,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  )
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Positioner> & {
  sideOffset?: number
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn("z-50", className)}
        {...props}
      >
        <TooltipPrimitive.Popup className="rounded-md border border-slate-200 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-md outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent }
