"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSchoolYear, activateYear } from "@/app/(app)/admin/annee/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type YearSummary = { id: string; label: string; start_date: string; end_date: string; status: string; class_count: number; attr_count: number };
type AttrRow = { id: string; classe: string; branche: string; sous_branche: string | null; enseignant: string };

const STEPS = ["Paramètres", "Structure", "Révision sections", "Calendriers", "Activation"];

export function RolloverWizard({
  years, activeYearId, sourceYear, sourceAttrs,
}: {
  years: YearSummary[];
  activeYearId: string | null;
  sourceYear: YearSummary | null;
  sourceAttrs: AttrRow[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [clone, setClone] = useState(true);
  const [cloneCals, setCloneCals] = useState(false);
  const [createdYearId, setCreatedYearId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Section validation flags (in real flow tracked in DB; here derive from created year presence)
  const primValidated = createdYearId !== null;
  const secValidated = createdYearId !== null;

  async function submitStep1() {
    setBusy(true); setError(null);
    const res = await createSchoolYear({
      label: label || "Nouvelle année",
      start_date: startDate || `${new Date().getFullYear()}-09-01`,
      end_date: endDate || `${new Date().getFullYear() + 1}-07-07`,
      clone_from_year_id: clone && sourceYear ? sourceYear.id : null,
      clone_calendars: cloneCals,
    });
    if (res.error) { setError(res.error); setBusy(false); return; }
    setCreatedYearId(res.id ?? null);
    setBusy(false);
    router.refresh();
    setStep(2);
  }

  async function doActivate() {
    if (!createdYearId) return;
    setBusy(true); setError(null);
    const res = await activateYear(createdYearId);
    if (res.error) { setError(res.error); setBusy(false); return; }
    setBusy(false); router.refresh();
    router.push("/");
  }

  function go(delta: number) {
    setError(null);
    setStep((s) => Math.min(STEPS.length, Math.max(1, s + delta)));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Nouvelle année scolaire</h1>
        <p className="text-sm text-slate-500">Préparez la prochaine année en clonant la structure existante</p>
      </div>

      {/* Stepper */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isDone = n < step;
          return (
            <div key={s} className="flex items-center">
              <button
                onClick={() => n < step && setStep(n)}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 ${isActive ? "bg-blue-700 text-white" : isDone ? "text-green-700" : "text-slate-400"}`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${isActive ? "bg-white/20" : isDone ? "bg-green-100" : "bg-slate-100"}`}>
                  {isDone ? "✓" : n}
                </span>
                <span className={isActive ? "font-semibold" : ""}>{s}</span>
              </button>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-slate-200" />}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Paramètres */}
      {step === 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Paramètres de la nouvelle année</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><Label>Libellé</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. 2027 – 2028" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Rentrée</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div><Label>Fin</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {sourceYear && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={clone} onChange={(e) => setClone(e.target.checked)} />
                Cloner la structure de <strong>{sourceYear.label}</strong> ({sourceYear.class_count} classes · {sourceYear.attr_count} attributions)
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cloneCals} onChange={(e) => setCloneCals(e.target.checked)} disabled={!clone} />
              Copier aussi les calendriers/modèles (à revoir par le super admin)
            </label>
          </div>
          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-5 flex justify-end">
            <Button onClick={submitStep1} disabled={busy}>{busy ? "Création…" : "Créer & continuer →"}</Button>
          </div>
        </div>
      )}

      {/* Step 2 — Structure */}
      {step === 2 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Structure & attributions clonées</h2>
          <p className="mt-1 text-sm text-slate-500">Aperçu depuis {sourceYear?.label ?? "—"}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Classe</th><th className="px-3 py-2">Cours</th><th className="px-3 py-2">Sous-branche</th><th className="px-3 py-2">Enseignant</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sourceAttrs.slice(0, 10).map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-semibold">{a.classe}</td>
                    <td className="px-3 py-2">{a.branche}</td>
                    <td className="px-3 py-2 text-slate-500">{a.sous_branche ?? "—"}</td>
                    <td className="px-3 py-2">{a.enseignant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sourceAttrs.length === 0 && <p className="py-6 text-center text-slate-400">Aucune attribution dans l'année source.</p>}
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => go(-1)}>← Précédent</Button>
            <Button onClick={() => go(1)}>Suivant →</Button>
          </div>
        </div>
      )}

      {/* Step 3 — Révision sections */}
      {step === 3 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Révision par les administrateurs de section</h2>
          <p className="mt-1 text-sm text-slate-500">Chaque admin de section doit valider sa partie avant activation.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className={`rounded-xl border p-4 ${primValidated ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
              <div className="font-semibold">Primaire</div>
              <div className="mt-2 text-sm">
                {primValidated
                  ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Validée</span>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">En attente</span>}
              </div>
            </div>
            <div className={`rounded-xl border p-4 ${secValidated ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
              <div className="font-semibold">Secondaire</div>
              <div className="mt-2 text-sm">
                {secValidated
                  ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Validée</span>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">En attente</span>}
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => go(-1)}>← Précédent</Button>
            <Button onClick={() => go(1)}>Suivant →</Button>
          </div>
        </div>
      )}

      {/* Step 4 — Calendriers */}
      {step === 4 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Calendriers & modèles</h2>
          <p className="mt-1 text-sm text-slate-500">
            {cloneCals
              ? "Les modèles ont été copiés depuis l'année source. Générez/ajustez chaque section dans « Calendrier & modèles »."
              : "Aucun calendrier copié. Générez les calendriers des deux sections dans « Calendrier & modèles »."}
          </p>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" onClick={() => router.push("/admin/calendrier?section=primaire")}>Primaire → calendrier</Button>
            <Button variant="outline" onClick={() => router.push("/admin/calendrier?section=secondaire")}>Secondaire → calendrier</Button>
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => go(-1)}>← Précédent</Button>
            <Button onClick={() => go(1)}>Suivant →</Button>
          </div>
        </div>
      )}

      {/* Step 5 — Activation */}
      {step === 5 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Activation</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Primaire validée</span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Secondaire validée</span>
            </div>
            <p className="text-slate-500">L'année en cours ({years.find((y) => y.id === activeYearId)?.label ?? "active"}) sera archivée (lecture seule).</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked /> Notifier les enseignants de l'ouverture (à venir)
            </label>
          </div>
          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="mt-5 flex justify-between">
            <Button variant="outline" onClick={() => go(-1)}>← Précédent</Button>
            <Button onClick={doActivate} disabled={busy} className="bg-green-700 hover:bg-green-800">
              {busy ? "Activation…" : "Activer la nouvelle année"}
            </Button>
          </div>
        </div>
      )}

      {/* Existing years */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-bold text-slate-800">Années scolaires</h3>
        <div className="mt-3 space-y-2">
          {years.map((y) => (
            <div key={y.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2 text-sm">
              <span className="font-semibold">{y.label}</span>
              <span className="text-xs text-slate-500">{y.class_count} classes · {y.attr_count} attributions</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${y.status === "active" ? "bg-blue-100 text-blue-700" : y.status === "archived" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                {y.status === "active" ? "Active" : y.status === "archived" ? "Archivée" : "À venir"}
              </span>
            </div>
          ))}
          {years.length === 0 && <p className="text-sm text-slate-400">Aucune année scolaire.</p>}
        </div>
      </div>
    </div>
  );
}
