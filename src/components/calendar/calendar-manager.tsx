"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { generateCalendar } from "@/app/(app)/admin/calendrier/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type Row = {
  id: string;
  row_uuid: string;
  ordre: number;
  row_type: "enseignement" | "evenement";
  mois: string | null;
  semaine_num: number | null;
  date_label: string | null;
  periode_label: string | null;
  evenement_label: string | null;
};

const MONTH_NAMES = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const MONTHS_SHORT = ["Janv","Févr","Mars","Avr","Mai","Juin","Juil","Août","Sept","Oct","Nov","Déc"];
const DOW = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

function rowColor(type: string) {
  if (type === "enseignement") return "bg-blue-100 text-blue-700";
  if (type === "evaluation") return "bg-purple-100 text-purple-700";
  if (type === "examen") return "bg-red-100 text-red-700";
  if (type === "revision") return "bg-amber-100 text-amber-700";
  return "bg-yellow-100 text-yellow-700"; // vacances/detente
}

export function CalendarManager({
  yearId, yearLabel, section, versionInfo, rows,
}: {
  yearId: string;
  yearLabel: string;
  section: "primaire" | "secondaire";
  versionInfo: { id: string; version: number } | null;
  rows: Row[];
}) {
  const router = useRouter();
  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth, setViewMonth] = useState(8); // 0-indexed; Sept for demo
  const [selected, setSelected] = useState<Row | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState({ startDate: "2026-09-01", endDate: "2027-07-07", events: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionLabel = section === "primaire" ? "Primaire" : "Secondaire";

  function switchSection(s: string) {
    router.push(`/admin/calendrier?section=${s}`);
  }

  function changeMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  }

  // Build the calendar grid for the viewed month, placing rows on their start day.
  const grid = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    // Monday-first: js getDay 0=Sun -> index (day+6)%7
    const lead = (first.getDay() + 6) % 7;

    // Build cells: previous-month trailing, current month days
    const cells: { date: Date; inMonth: boolean; key: string }[] = [];
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = lead - 1; i >= 0; i--) {
      cells.push({ date: new Date(viewYear, viewMonth - 1, prevMonthDays - i), inMonth: false, key: `p${i}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(viewYear, viewMonth, d), inMonth: true, key: `d${d}` });
    }
    // pad to full weeks
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ date: next, inMonth: false, key: `n${cells.length}` });
    }

    // Map teaching rows (semaine_num + date_label) — attach to the Monday date parsed from date_label start
    const rowsByDate = new Map<string, Row[]>();
    for (const r of rows) {
      // date_label like "01/09/2026 → 04/09/2026"
      const m = r.date_label?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m && r.row_type === "enseignement") {
        const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
        const arr = rowsByDate.get(key) ?? [];
        arr.push(r); rowsByDate.set(key, arr);
      }
      // event rows: attach at their start date
      if (m && r.row_type === "evenement") {
        const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
        const arr = rowsByDate.get(key) ?? [];
        arr.push(r); rowsByDate.set(key, arr);
      }
    }

    return { cells, rowsByDate, daysInMonth };
  }, [viewYear, viewMonth, rows]);

  async function submitGenerate() {
    setBusy(true); setError(null);
    const res = await generateCalendar({
      yearId, section,
      startDate: genForm.startDate,
      endDate: genForm.endDate,
      events: genForm.events
        .split("\n").map((l) => l.trim()).filter(Boolean)
        .map((line) => {
          // format: "label | type | dd/mm/yyyy-dd/mm/yyyy" or "label | type | start-end"
          const parts = line.split("|").map((s) => s.trim());
          const label = parts[0];
          const type = parts[1] ?? "vacances";
          const range = parts[2] ?? "";
          const [s, e] = range.split("-").map((x) => x.trim());
          const start = s ?? genForm.startDate;
          const end = e ?? start;
          return { label, type, start, end };
        }),
    });
    if (res.error) { setError(res.error); setBusy(false); return; }
    setGenOpen(false); setBusy(false); router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendrier · {sectionLabel}</h1>
          <p className="text-sm text-slate-500">
            Année {yearLabel}
            {versionInfo ? ` · Modèle v${versionInfo.version} (actif)` : " · aucun modèle généré"}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={section}
            onChange={(e) => switchSection(e.target.value)}
          >
            <option value="primaire">Primaire</option>
            <option value="secondaire">Secondaire</option>
          </select>
          <Button onClick={() => setGenOpen(true)}><span className="mr-1">+</span> Générer le calendrier</Button>
        </div>
      </div>

      {!versionInfo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Aucun modèle actif pour {sectionLabel} · {yearLabel}. Cliquez « Générer le calendrier » pour créer les semaines.
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => changeMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50">‹</button>
        <div className="w-48 text-center text-lg font-bold text-slate-800">{MONTH_NAMES[viewMonth]} {viewYear}</div>
        <button onClick={() => changeMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50">›</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Calendar grid */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">
            {DOW.map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px bg-slate-100">
            {grid.cells.map((c) => {
              const key = `${c.date.getFullYear()}-${c.date.getMonth()}-${c.date.getDate()}`;
              const dayRows = grid.rowsByDate.get(key) ?? [];
              return (
                <div
                  key={c.key}
                  className={`min-h-[72px] bg-white p-1 ${c.inMonth ? "" : "bg-slate-50 text-slate-400"}`}
                >
                  <div className="px-1 text-xs font-bold">{c.date.getDate()}</div>
                  <div className="mt-0.5 space-y-0.5">
                    {dayRows.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setSelected(r)}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold ${rowColor(r.row_type === "enseignement" ? "enseignement" : (r.evenement_label ?? "vacances"))}`}
                        title={r.periode_label ?? r.date_label ?? ""}
                      >
                        {r.row_type === "enseignement" ? `S${r.semaine_num}` : (r.periode_label ?? r.evenement_label)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">Semaine sélectionnée</h3>
          {selected ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">N°</span><span className="font-semibold">{selected.row_type === "enseignement" ? `S${selected.semaine_num}` : "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-slate-500">Dates</span><span className="text-right">{selected.date_label ?? "—"}</span></div>
              <div className="flex justify-between gap-2"><span className="text-slate-500">Période</span><span className="text-right">{selected.periode_label ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Type</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${rowColor(selected.row_type === "enseignement" ? "enseignement" : (selected.evenement_label ?? "vacances"))}`}>
                  {selected.row_type === "enseignement" ? "Enseignement" : (selected.evenement_label ?? "Événement")}
                </span>
              </div>
              <div className="pt-2 text-xs text-slate-400">Édition détaillée (type/période) à venir dans la vue complète.</div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Cliquez sur une semaine ou un événement du calendrier.</p>
          )}
        </div>
      </div>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Générer le calendrier — {sectionLabel}</DialogTitle>
            <DialogDescription>Crée les semaines de l'année (du lundi au vendredi) numérotées à partir de la rentrée.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Rentrée</Label><Input type="date" value={genForm.startDate} onChange={(e) => setGenForm({ ...genForm, startDate: e.target.value })} /></div>
              <div><Label>Fin d'année</Label><Input type="date" value={genForm.endDate} onChange={(e) => setGenForm({ ...genForm, endDate: e.target.value })} /></div>
            </div>
            <div>
              <Label>Événements (une par ligne)</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={4}
                placeholder={"Vacances de Noël | vacances | 21/12/2026-09/01/2027\nExamens 1er trim | examen | 09/02/2027-17/02/2027"}
                value={genForm.events}
                onChange={(e) => setGenForm({ ...genForm, events: e.target.value })}
              />
              <p className="text-xs text-slate-400">Format : libellé | type | début-fin (jj/mm/aaaa-jj/mm/aaaa)</p>
            </div>
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>Annuler</Button>
            <Button onClick={submitGenerate} disabled={busy}>{busy ? "Génération…" : "Générer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
