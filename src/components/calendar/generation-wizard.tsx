"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { generateCalendar } from "@/app/(app)/admin/calendrier/actions";
import { buildWeeks, type Week } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STEPS = ["Paramètres", "Événements", "Aperçu", "Confirmation"] as const;

// Canonical stored values — MUST match the calendar editor's vocabulary
// (rowColor/eventWash key on these exact strings). Labels stay French.
export type EventType = "vacances" | "evaluation" | "examen" | "revision" | "detente";

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "vacances", label: "Vacances" },
  { value: "evaluation", label: "Évaluation" },
  { value: "examen", label: "Examen" },
  { value: "revision", label: "Révision" },
  { value: "detente", label: "Détente" },
];

const EVENT_BAND: Record<EventType, string> = {
  evaluation: "bg-purple-100 text-purple-700",
  examen: "bg-red-100 text-red-700",
  revision: "bg-amber-100 text-amber-700",
  vacances: "bg-yellow-100 text-yellow-700",
  detente: "bg-yellow-100 text-yellow-700",
};

export type WizardEvent = {
  id: string;
  label: string;
  type: EventType;
  start: string;
  end: string;
};

function frDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export type ResumeInfo = {
  versionId: string;
  version: number;
};

export type WizardInitialEvent = {
  label: string;
  type: EventType;
  start: string;
  end: string;
};

export function GenerationWizard({
  yearId,
  yearLabel,
  yearStart,
  yearEnd,
  section,
  activeVersion,
  resume = null,
  initialParams = null,
  initialEvents = null,
}: {
  yearId: string;
  yearLabel: string;
  yearStart: string;
  yearEnd: string;
  section: "primaire" | "secondaire";
  activeVersion: number | null;
  resume?: ResumeInfo | null;
  initialParams?: { startDate: string; endDate: string } | null;
  initialEvents?: WizardInitialEvent[] | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asDraft, setAsDraft] = useState(false);

  const [params, setParams] = useState({
    section,
    startDate: initialParams?.startDate ?? yearStart,
    endDate: initialParams?.endDate ?? yearEnd,
  });
  const [events, setEvents] = useState<WizardEvent[]>(() =>
    (initialEvents ?? []).map((e) => ({ ...e, id: crypto.randomUUID() }))
  );

  const sectionLabel = params.section === "primaire" ? "Primaire" : "Secondaire";

  function nextFromParams() {
    setError(null);
    if (!params.startDate || !params.endDate) {
      setError("La rentrée et la fin d'année sont obligatoires.");
      return;
    }
    if (params.startDate > params.endDate) {
      setError("La rentrée doit précéder la fin d'année.");
      return;
    }
    setStep(2);
  }

  function nextFromEvents() {
    setError(null);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const row = `Ligne ${i + 1}`;
      if (!e.label.trim()) { setError(`${row} : le libellé est obligatoire.`); return; }
      if (!e.start || !e.end) { setError(`${row} : les dates de début et de fin sont obligatoires.`); return; }
      if (e.start > e.end) { setError(`${row} : la date de début doit précéder la fin.`); return; }
      if (e.start < params.startDate || e.end > params.endDate) {
        setError(`${row} : l'événement doit se situer entre la rentrée et la fin d'année.`);
        return;
      }
    }
    setStep(3);
  }

  function addEvent() {
    setEvents((evs) => [
      ...evs,
      { id: crypto.randomUUID(), label: "", type: "vacances", start: "", end: "" },
    ]);
  }

  function patchEvent(id: string, patch: Partial<WizardEvent>) {
    setEvents((evs) => evs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeEvent(id: string) {
    setEvents((evs) => evs.filter((e) => e.id !== id));
  }

  // Client-side preview: same week math the server will use.
  const preview = useMemo(() => {
    const start = new Date(`${params.startDate}T12:00:00`);
    const end = new Date(`${params.endDate}T12:00:00`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;
    const weeks = buildWeeks(start, end);
    const parsed = events
      .filter((e) => e.label.trim() && e.start && e.end && e.start <= e.end)
      .map((e) => ({
        ...e,
        startDate: new Date(`${e.start}T12:00:00`),
        endDate: new Date(`${e.end}T12:00:00`),
      }));
    const bands = new Map<number, typeof parsed>();
    for (const w of weeks) {
      const hit = parsed.filter((e) => w.start <= e.endDate && e.startDate <= w.end);
      if (hit.length > 0) bands.set(w.semaine_num, hit);
    }
    // Condensed list: first 2 weeks, last week, and band weeks always show;
    // plain runs collapse to a single ellipsis marker.
    const rows: ({ kind: "week"; week: Week } | { kind: "gap"; key: number })[] = [];
    let gapOpen = false;
    weeks.forEach((w, i) => {
      const show = i < 2 || i === weeks.length - 1 || bands.has(w.semaine_num);
      if (show) {
        rows.push({ kind: "week", week: w });
        gapOpen = false;
      } else if (!gapOpen) {
        rows.push({ kind: "gap", key: w.semaine_num });
        gapOpen = true;
      }
    });
    return { weeks, courseDays: weeks.length * 5, bands, rows };
  }, [params.startDate, params.endDate, events]);

  async function submitGenerate() {
    setBusy(true); setError(null);
    try {
      const res = await generateCalendar({
        yearId,
        section: params.section,
        startDate: params.startDate,
        endDate: params.endDate,
        events: events.map((e) => ({ label: e.label.trim(), type: e.type, start: e.start, end: e.end })),
        active: !asDraft,
        resumeVersionId: resume?.versionId,
      });
      if (res.error) { setError(res.error); setBusy(false); return; }
    } catch {
      setError("La requête n'a pas abouti. Vérifiez si le calendrier a été généré, puis réessayez.");
      setBusy(false); return;
    }
    setBusy(false);
    router.push(`/admin/calendrier?section=${params.section}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {resume ? `Reprendre le calendrier — ${sectionLabel} (brouillon v${resume.version})` : `Générer le calendrier — ${sectionLabel}`}
        </h1>
        <p className="text-sm text-slate-500">Année {yearLabel}</p>
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex items-center gap-2">
              {n > 1 && <span className="h-px w-6 bg-slate-300" aria-hidden />}
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-green-600 text-white"
                    : current
                      ? "bg-blue-700 text-white"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? "✓" : n}
              </span>
              <span className={`text-xs font-semibold ${current ? "text-blue-700" : done ? "text-green-700" : "text-slate-400"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">Paramètres de l&apos;année</h2>
          <p className="mt-1 text-xs text-slate-500">
            Les semaines (lundi → vendredi) seront numérotées à partir de la rentrée.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Année scolaire</Label>
              <Input value={yearLabel} disabled />
            </div>
            <div>
              <Label>Section</Label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                value={params.section}
                disabled={!!resume}
                title={resume ? "La section est verrouillée en reprise de brouillon." : undefined}
                onChange={(e) => setParams({ ...params, section: e.target.value as "primaire" | "secondaire" })}
              >
                <option value="primaire">Primaire</option>
                <option value="secondaire">Secondaire</option>
              </select>
              {resume && (
                <p className="mt-1 text-[11px] text-slate-500">Section verrouillée — le brouillon appartient au {sectionLabel}.</p>
              )}
            </div>
            <div>
              <Label>Rentrée (premier lundi)</Label>
              <Input type="date" value={params.startDate} onChange={(e) => setParams({ ...params, startDate: e.target.value })} />
            </div>
            <div>
              <Label>Fin d&apos;année (dernier vendredi)</Label>
              <Input type="date" value={params.endDate} onChange={(e) => setParams({ ...params, endDate: e.target.value })} />
            </div>
          </div>
          {resume && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Reprise du brouillon v{resume.version} — dates et événements déjà saisis sont
              pré-remplis. La génération mettra à jour ce brouillon (aucune nouvelle version créée).
            </div>
          )}
          {activeVersion !== null && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Un modèle actif existe déjà (v{activeVersion}). Vous pouvez soit l&apos;activer immédiatement (la v{activeVersion} sera désactivée), soit laisser la nouvelle version en brouillon pour l&apos;éditer ensuite.
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <span className="flex-1" />
            <Button onClick={nextFromParams}>Continuer →</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">Événements de l&apos;année</h2>
          <p className="mt-1 text-xs text-slate-500">Chaque événement a ses vrais champs — aucun format texte à deviner.</p>
          <div className="mt-4 space-y-2">
            {events.map((e, i) => (
              <div key={e.id} className="grid items-end gap-2 sm:grid-cols-[1fr_130px_140px_140px_32px]">
                <div>
                  <Label>Libellé</Label>
                  <Input
                    value={e.label}
                    placeholder={`Événement ${i + 1}`}
                    onChange={(ev) => patchEvent(e.id, { label: ev.target.value })}
                  />
                </div>
                <div>
                  <Label>Type</Label>
                  <select
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={e.type}
                    onChange={(ev) => patchEvent(e.id, { type: ev.target.value as EventType })}
                  >
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Début</Label>
                  <Input type="date" value={e.start} onChange={(ev) => patchEvent(e.id, { start: ev.target.value })} />
                </div>
                <div>
                  <Label>Fin</Label>
                  <Input type="date" value={e.end} onChange={(ev) => patchEvent(e.id, { end: ev.target.value })} />
                </div>
                <button
                  type="button"
                  title="Supprimer"
                  onClick={() => removeEvent(e.id)}
                  className="flex h-9 w-8 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                >
                  ×
                </button>
              </div>
            ))}
            {events.length === 0 && (
              <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Aucun événement pour l&apos;instant — une année peut démarrer sans événements.
              </p>
            )}
          </div>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={addEvent}>+ Ajouter un événement</Button>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => { setError(null); setStep(1); }}>← Retour</Button>
            <span className="flex-1" />
            <Button onClick={nextFromEvents}>Voir l&apos;aperçu →</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">Aperçu du calendrier généré</h2>
          {preview ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                <strong>{preview.weeks.length} semaines · {preview.courseDays} jours de cours · {events.length} événement{events.length > 1 ? "s" : ""}</strong> — vérifiez avant de générer.
              </p>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                {preview.rows.map((r) =>
                  r.kind === "gap" ? (
                    <div key={`gap-${r.key}`} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-400">
                      <span className="font-bold">…</span>
                      <span>semaines d&apos;enseignement</span>
                    </div>
                  ) : (
                    <div key={r.week.semaine_num} className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-xs last:border-0">
                      <span className="min-w-10 font-bold text-slate-800">S{String(r.week.semaine_num).padStart(2, "0")}</span>
                      <span className="text-slate-500">{frDate(r.week.start.toISOString().slice(0, 10))} → {frDate(r.week.end.toISOString().slice(0, 10))}</span>
                      {(preview.bands.get(r.week.semaine_num) ?? []).map((e) => (
                        <span key={e.id} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${EVENT_BAND[e.type]}`}>
                          {e.label}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-red-600">Plage de dates invalide — retournez à l&apos;étape 1.</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => { setError(null); setStep(2); }}>← Modifier les événements</Button>
            <span className="flex-1" />
            <Button onClick={() => { setError(null); setStep(4); }} disabled={!preview}>Confirmer →</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">Confirmation</h2>
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {resume ? (
              <>
                Mettre à jour le <strong>brouillon v{resume.version} ({sectionLabel} · {yearLabel})</strong> : {preview ? `${preview.weeks.length} semaines + ${events.length} événement${events.length > 1 ? "s" : ""}` : "plage invalide"}.
                {asDraft
                  ? " Il restera brouillon — la version active actuelle reste inchangée."
                  : activeVersion !== null
                    ? ` Il sera activé aussitôt — la v${activeVersion} sera désactivée.`
                    : " Il sera activé (première version active)."}
              </>
            ) : (
              <>
                Générer le calendrier <strong>{sectionLabel} · {yearLabel}</strong> : {preview ? `${preview.weeks.length} semaines + ${events.length} événement${events.length > 1 ? "s" : ""}` : "plage invalide"},
                en <strong>version {(activeVersion ?? 0) + 1}</strong>.
                {asDraft
                  ? " Sauvegardée comme brouillon — la version active actuelle reste inchangée."
                  : activeVersion !== null
                    ? ` Activée aussitôt — la v${activeVersion} sera désactivée.`
                    : " Ce sera la première version active."}
              </>
            )}
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
              checked={asDraft}
              onChange={(e) => setAsDraft(e.target.checked)}
            />
            <span>
              <strong>Sauvegarder en brouillon</strong> — générer sans activer, pour éditer le
              calendrier plus tard depuis la page calendrier.
            </span>
          </label>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => { setError(null); setStep(3); }}>← Retour</Button>
            <span className="flex-1" />
            <Button
              onClick={submitGenerate}
              disabled={busy || !preview}
              className={preview ? "bg-green-700 hover:bg-green-800" : ""}
            >
              {busy ? "Génération…" : resume ? (asDraft ? "Mettre à jour le brouillon" : "Mettre à jour et activer") : asDraft ? "Sauvegarder le brouillon" : "Générer le calendrier"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
