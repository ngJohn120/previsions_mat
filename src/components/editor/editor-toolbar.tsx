import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sticky editing bar shown above the document grid (hidden on print).
 */
export function EditorToolbar({
  backHref,
  backLabel,
  title,
  subtitle,
  statut,
  complete,
  submitting,
  onSubmit,
  printHref,
  syncLabel,
  extra,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle: string;
  statut: "brouillon" | "soumise";
  complete: boolean;
  submitting?: boolean;
  onSubmit?: () => void;
  printHref?: string;
  syncLabel?: string;
  extra?: React.ReactNode;
}) {
  const editable = statut === "brouillon";

  return (
    <div className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-3 px-4 py-2.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          ← {backLabel}
        </Link>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-slate-900">{title}</div>
          <div className="truncate text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="flex-1" />
        {syncLabel && (
          <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 md:inline-flex">
            <span className={cn("h-1.5 w-1.5 rounded-full", statut === "soumise" ? "bg-blue-500" : "bg-green-500")} />
            {syncLabel}
          </span>
        )}
        {printHref && (
          <Link
            href={printHref}
            target="_blank"
            className="inline-flex h-7 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Aperçu impression
          </Link>
        )}
        {onSubmit && editable && (
          <Button size="sm" onClick={onSubmit} disabled={!complete || submitting}>
            {submitting ? "Soumission…" : "Soumettre"}
          </Button>
        )}
        {extra}
      </div>
    </div>
  );
}
