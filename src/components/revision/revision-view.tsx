"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activateYear, revokeSectionValidation, validateSection } from "@/app/(app)/admin/annee/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RosterBlock } from "@/components/roster/roster-block";
import type { Section } from "@/lib/auth";

export type RevisionData = {
  year: { id: string; label: string; start_date: string; end_date: string } | null;
  viewerIsSuper: boolean;
  viewerSections: Section[];
  currentYearLabel: string;
  validations: { section: Section; validatedByName: string; validatedAt: string }[];
  attributions: {
    id: string;
    section: Section;
    classe: string;
    cours: string;
    sousBranche: string | null;
    enseignant: string;
  }[];
  roster: Record<
    Section,
    { userId: string; name: string; isActive: boolean; assignmentCount: number; accountDisabled: boolean }[]
  >;
  orphans: Record<
    Section,
    {
      attributionOrphans: { id: string; classe: string; cours: string; teacherName: string }[];
      titulaireOrphans: { classId: string; className: string; teacherName: string }[];
    }
  >;
};

const SECTION_LABEL: Record<Section, string> = { primaire: "Primaire", secondaire: "Secondaire" };

function frDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} à ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function isoDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export function RevisionView({
  year, viewerIsSuper, viewerSections, currentYearLabel, validations, attributions, roster, orphans,
}: RevisionData) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters (structure table, per section card)
  const [search, setSearch] = useState("");
  const [cours, setCours] = useState("");
  const [enseignant, setEnseignant] = useState("");

  const bySection = useMemo(() => {
    const m: Record<Section, RevisionData["attributions"]> = { primaire: [], secondaire: [] };
    for (const a of attributions) m[a.section].push(a);
    return m;
  }, [attributions]);

  const validationOf = (s: Section) => validations.find((v) => v.section === s) ?? null;

  const orphanCountOf = (s: Section) =>
    (orphans[s]?.attributionOrphans.length ?? 0) + (orphans[s]?.titulaireOrphans.length ?? 0);
  const orphanNamesOf = (s: Section) => [
    ...new Set([
      ...(orphans[s]?.attributionOrphans ?? []).map((o) => o.teacherName),
      ...(orphans[s]?.titulaireOrphans ?? []).map((o) => o.teacherName),
    ]),
  ];
  const orphanAttrIdsOf = (s: Section) =>
    new Set((orphans[s]?.attributionOrphans ?? []).map((o) => o.id));

  // Section admin sees only their section card full-width (+ a slim strip for
  // the other section); super admin sees both cards side by side.
  const visibleSections = viewerIsSuper ? (["primaire", "secondaire"] as Section[]) : viewerSections;
  const hiddenSections = (["primaire", "secondaire"] as Section[]).filter(
    (s) => !visibleSections.includes(s)
  );

  function filteredRows(section: Section) {
    const q = search.toLowerCase();
    return bySection[section].filter(
      (a) =>
        (!q ||
          a.classe.toLowerCase().includes(q) ||
          a.cours.toLowerCase().includes(q) ||
          (a.sousBranche ?? "").toLowerCase().includes(q) ||
          a.enseignant.toLowerCase().includes(q)) &&
        (!cours || a.cours === cours) &&
        (!enseignant || a.enseignant === enseignant)
    );
  }

  const filterActive = search !== "" || cours !== "" || enseignant !== "";

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true); setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  const canManageSection = (s: Section) => !viewerIsSuper && viewerSections.includes(s);

  if (!year) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Révision de la nouvelle année</h1>
          <p className="text-sm text-slate-500">Aucune année en préparation pour le moment.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {viewerIsSuper
            ? "Créez la prochaine année depuis la page Année (étape 5 — Activation)."
            : "Lorsqu'une nouvelle année sera préparée par la direction, elle apparaîtra ici pour validation."}
        </div>
      </div>
    );
  }

  const bothValidated = validationOf("primaire") !== null && validationOf("secondaire") !== null;
  const validatedCount = (validationOf("primaire") ? 1 : 0) + (validationOf("secondaire") ? 1 : 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Révision de la nouvelle année</h1>
        <p className="text-sm text-slate-500">
          Structure clonée depuis {currentYearLabel} — validation par les administrateurs de section.
        </p>
      </div>

      {/* Year banner */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <div className="text-[17px] font-bold text-slate-900">Année scolaire {year.label}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            Rentrée {isoDate(year.start_date)} · Fin {isoDate(year.end_date)}
          </div>
        </div>
        <div className="ml-auto">
          {viewerIsSuper ? (
            bothValidated ? (
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">2/2 validée — activation possible</span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">{validatedCount}/2 validée — activation indisponible</span>
            )
          ) : validationOf(viewerSections[0]) ? (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">Votre section est validée</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">En attente de votre validation</span>
          )}
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Section cards (own section full-width for section admins; both side by side for super admin) */}
      <div className={`grid gap-4 ${viewerIsSuper ? "md:grid-cols-2" : ""}`}>
        {visibleSections.map((s) => {
          const validation = validationOf(s);
          const mine = canManageSection(s);
          const rows = mine ? filteredRows(s) : bySection[s];
          const orphanCount = orphanCountOf(s);
          const orphanNames = orphanNamesOf(s);
          const orphanAttrIds = orphanAttrIdsOf(s);
          const canToggle = (mine || viewerIsSuper) && !validation;
          return (
            <div
              key={s}
              className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${validation ? "border-green-200 bg-green-50/40" : "border-slate-200"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">{SECTION_LABEL[s]}</h3>
                {validation ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Validée</span>
                ) : orphanCount > 0 ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Orphelins à traiter</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">En attente</span>
                )}
              </div>

              <RosterBlock
                yearId={year.id}
                yearLabel={year.label}
                section={s}
                entries={roster[s] ?? []}
                orphanCount={orphanCount}
                orphanNames={orphanNames}
                blocking
                canToggle={canToggle}
              />

              <p className="text-xs leading-relaxed text-slate-500">
                {bySection[s].length} attribution{bySection[s].length > 1 ? "s" : ""} reprise{bySection[s].length > 1 ? "s" : ""} depuis {currentYearLabel}.
              </p>

                  {mine && (
                    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                      <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                      <Input
                        className="h-8 min-w-[160px] flex-1 text-xs"
                        placeholder="Rechercher une classe, un cours, un enseignant…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <select
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
                        value={cours}
                        onChange={(e) => setCours(e.target.value)}
                      >
                        <option value="">Cours : tous</option>
                        {[...new Set(bySection[s].map((a) => a.cours))].map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <select
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
                        value={enseignant}
                        onChange={(e) => setEnseignant(e.target.value)}
                      >
                        <option value="">Enseignant : tous</option>
                        {[...new Set(bySection[s].map((a) => a.enseignant))].map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <span className="ml-auto text-[11px] font-bold text-slate-400">
                        {filterActive
                          ? `${rows.length} attribution${rows.length > 1 ? "s" : ""} affichée${rows.length > 1 ? "s" : ""}`
                          : `${rows.length} attribution${rows.length > 1 ? "s" : ""}`}
                      </span>
                    </div>
                  )}

                  <div className="max-h-56 overflow-x-auto overflow-y-auto rounded-b-lg border border-t-0 border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="bg-slate-50 px-2.5 py-1.5">Classe</th>
                          <th className="bg-slate-50 px-2.5 py-1.5">Cours</th>
                          <th className="bg-slate-50 px-2.5 py-1.5">Sous-branche</th>
                          <th className="bg-slate-50 px-2.5 py-1.5">Enseignant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((a) => (
                          <tr key={a.id} className={orphanAttrIds.has(a.id) ? "bg-red-50" : ""}>
                            <td className="px-2.5 py-1.5 font-semibold">{a.classe}</td>
                            <td className="px-2.5 py-1.5">{a.cours}</td>
                            <td className="px-2.5 py-1.5 text-slate-500">{a.sousBranche ?? "—"}</td>
                            <td className={`px-2.5 py-1.5 ${orphanAttrIds.has(a.id) ? "font-bold text-red-700" : ""}`}>{a.enseignant}</td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={4} className="px-2.5 py-4 text-center text-slate-400">Aucun résultat.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Validation state / actions */}
                  <div className="mt-auto border-t border-dashed border-slate-200 pt-3 text-xs">
                    {validation ? (
                      <div className="space-y-2">
                        <div className="text-slate-600">
                          Validée par <strong>{validation.validatedByName}</strong> — {frDate(validation.validatedAt)}
                        </div>
                        {viewerIsSuper ? (
                          <Button
                            variant="outline" size="sm" disabled={busy}
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => run(() => revokeSectionValidation({ yearId: year.id, section: s }))}
                          >
                            Retirer la validation
                          </Button>
                        ) : mine ? (
                          <Button
                            variant="outline" size="sm" disabled={busy}
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => run(() => revokeSectionValidation({ yearId: year.id, section: s }))}
                          >
                            Retirer ma validation
                          </Button>
                        ) : null}
                      </div>
                    ) : mine ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" disabled={busy || orphanCount > 0} onClick={() => run(() => validateSection({ yearId: year.id, section: s }))}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                          {busy ? "…" : "Valider ma section"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => router.push(`/${s}/structure`)}>
                          Revoir la structure
                        </Button>
                        {orphanCount > 0 && (
                          <span className="text-[11px] font-semibold text-red-600">
                            Validation verrouillée : {orphanCount} cours orphelin{orphanCount > 1 ? "s" : ""} à réassigner.
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">En attente — autre admin</span>
                    )}
                    {!mine && !validation && !viewerIsSuper && (
                      <span className="mt-2 block text-[11px] text-slate-400">Seul l&apos;administrateur de cette section peut valider.</span>
                    )}
                  </div>
            </div>
          );
        })}
      </div>

      {/* Slim strip for sections the viewer doesn't administer (section-admin view) */}
      {hiddenSections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          {hiddenSections.map((s) => (
            <span key={s} className="flex items-center gap-2">
              <strong>{SECTION_LABEL[s]}</strong>
              {validationOf(s) ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">Validée</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">En attente — autre admin</span>
              )}
            </span>
          ))}
          <span className="text-[11px] text-slate-400">Vous ne voyez ni son tableau ni son personnel.</span>
        </div>
      )}

      {/* Super admin activation */}
      {viewerIsSuper && (
        <div className="flex items-center gap-3">
          <Button
            disabled={busy || !bothValidated}
            className={bothValidated ? "bg-green-700 hover:bg-green-800" : ""}
            onClick={() => run(() => activateYear(year.id))}
            title={bothValidated ? undefined : "Désactivé tant que les 2 sections ne sont pas validées"}
          >
            {busy ? "Activation…" : "Activer la nouvelle année"}
          </Button>
          <span className="text-xs text-slate-500">
            {bothValidated
              ? `${currentYearLabel} sera archivée (lecture seule).`
              : "L'activation est verrouillée tant que les deux sections n'ont pas validé leur structure."}
          </span>
        </div>
      )}

      <p className="text-xs text-slate-400">
        La nouvelle année est activée par la direction une fois les deux sections validées. Les enseignants ouvriront alors
        leurs fiches de {year.label}.
      </p>
    </div>
  );
}
