"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { setTeacherYearActive } from "@/app/(app)/admin/annee/actions";
import type { Section } from "@/lib/auth";

export type RosterEntry = {
  userId: string;
  name: string;
  isActive: boolean;
  /** Attributions (cours taught) — what « N cours » used to claim. */
  assignmentCount: number;
  /** Classes where the teacher is titulaire — NOT a taught course. */
  titulaireCount: number;
  accountDisabled: boolean;
};

/** Shared Personnel roster block (Révision card + Structure strip).
 *  - Scrollable list with name search; orphan math always runs on the FULL
 *    list, never on the filtered view.
 *  - blocking=true (Révision, upcoming year): red orphan banner that locks
 *    validation. blocking=false (Structure strip): amber warning chip,
 *    non-blocking. */
export function RosterBlock({
  yearId,
  yearLabel,
  section,
  entries,
  orphanCount,
  orphanNames,
  blocking,
  canToggle,
}: {
  yearId: string;
  yearLabel: string;
  section: Section;
  entries: RosterEntry[];
  orphanCount: number;
  orphanNames: string[];
  blocking: boolean;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.toLowerCase();
  const shown = entries.filter((t) => !q || t.name.toLowerCase().includes(q));
  const activeCount = entries.filter((t) => t.isActive).length;

  async function flip(t: RosterEntry) {
    setBusy(true);
    setError(null);
    const res = await setTeacherYearActive({
      userId: t.userId,
      schoolYearId: yearId,
      section,
      isActive: !t.isActive,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          <span>Personnel {yearLabel} · {activeCount} en poste{q ? " · filtré" : ""}</span>
          <Input
            className="ml-auto h-7 max-w-[180px] min-w-[130px] flex-1 text-xs normal-case tracking-normal"
            placeholder="Rechercher un enseignant…"
            aria-label="Rechercher un enseignant"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-100">
              {shown.map((t) => (
                <tr key={t.userId} className={t.isActive ? "" : "bg-slate-50 text-slate-400"}>
                  <td className="px-2.5 py-1.5">
                    <div className="font-semibold text-slate-800">{t.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {t.assignmentCount} cours
                      {t.titulaireCount > 0 && (
                        <span title="Classe dont l'enseignant est titulaire — ce n'est pas un cours enseigné">
                          {" · "}
                          titulaire de {t.titulaireCount} classe{t.titulaireCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {t.accountDisabled && (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-px font-semibold text-amber-700">
                          Compte désactivé — toujours en poste
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.isActive ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"}`}>
                      {t.isActive ? "En poste" : "Hors poste"}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={t.isActive}
                      aria-label={`${t.name} en poste`}
                      disabled={busy || !canToggle}
                      onClick={() => flip(t)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${t.isActive ? "border-green-600 bg-green-100" : "border-slate-300 bg-slate-200"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${t.isActive ? "translate-x-5 bg-green-600" : "translate-x-0.5 bg-slate-400"}`} />
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td className="px-2.5 py-4 text-center text-slate-400">Aucun enseignant.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {orphanCount > 0 && blocking && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
          <strong>{orphanCount} cours orphelin{orphanCount > 1 ? "s" : ""}.</strong>{" "}
          {orphanNames.join(", ")} ne fait plus partie de l&apos;année — réassignez les lignes en rouge avant de valider.
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => router.push(`/${section}/attributions`)}>Réassigner dans Attributions</Button>
            <Button size="sm" variant="outline" onClick={() => router.push(`/${section}/structure`)}>Revoir la Structure</Button>
          </div>
        </div>
      )}

      {orphanCount > 0 && !blocking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">
            {orphanCount} cours assigné{orphanCount > 1 ? "s" : ""} à un enseignant hors poste cette année{orphanNames.length > 0 ? ` (${orphanNames.join(", ")})` : ""}.
          </span>
          <Button size="sm" variant="outline" onClick={() => router.push(`/${section}/attributions`)}>Réassigner dans Attributions</Button>
        </div>
      )}
    </div>
  );
}
