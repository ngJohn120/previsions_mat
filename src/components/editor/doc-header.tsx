import { SCHOOL, sectionLabel, titleForSection } from "@/lib/school";
import type { Section } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Paper-faithful document header (school line, centered title band,
 * metadata row). Used by both on-screen editor and print sheet.
 */
export function EditorDocHeader({
  section,
  classe,
  titulaireLabel,
  branche,
  sousBranche,
  yearLabel,
  titleOverride,
  dense,
}: {
  section: Section;
  classe: string;
  /** For primary: Titulaire; for secondary: Professeur */
  titulaireLabel: string;
  branche: string;
  sousBranche?: string | null;
  yearLabel: string;
  titleOverride?: string;
  dense?: boolean;
}) {
  const roleLabel = section === "primaire" ? "Titulaire" : "Professeur";
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 px-4 py-2">
        <div className="text-[13px] font-extrabold tracking-wide text-slate-900">
          {SCHOOL.name}
          <span className="font-normal text-slate-500"> · {SCHOOL.address}</span>
        </div>
        <div className="text-xs font-semibold text-slate-600">
          Année scolaire : <span className="border-b border-dotted border-slate-400 px-1">{yearLabel}</span>
        </div>
      </div>
      <div className={cn("border-b border-slate-200 bg-slate-50/60 text-center", dense ? "py-1.5" : "py-3")}>
        <div className="text-xl font-extrabold tracking-[1.5px] text-slate-900 uppercase">
          {titleOverride ?? titleForSection(section)}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-[12.5px]">
        <KV k="Section" v={sectionLabel(section)} />
        <KV k="Classe" v={classe} />
        <KV k={roleLabel} v={titulaireLabel} />
        <KV k="Branche" v={branche} />
        {sousBranche ? <KV k="Sous-branche" v={sousBranche} strong /> : null}
      </div>
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <b className="font-bold text-slate-700">{k} :</b>
      <span
        className={
          strong
            ? "border-b border-dotted border-blue-400 px-1 font-semibold text-blue-700"
            : "min-w-[70px] border-b border-dotted border-slate-300 px-1 text-slate-600"
        }
      >
        {v}
      </span>
    </span>
  );
}
