import { cn } from "@/lib/utils";

/** Progress toward completing required cells (fill %). */
export function CompletenessBar({
  filled,
  total,
  compact,
}: {
  filled: number;
  total: number;
  compact?: boolean;
}) {
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100);
  const complete = total > 0 && filled === total;

  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2")}>
      <span className="text-xs text-slate-500">Semaines remplies</span>
      <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            complete ? "bg-green-500" : "bg-blue-600"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-600">
        {filled} / {total}
      </span>
    </div>
  );
}
