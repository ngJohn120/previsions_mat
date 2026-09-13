"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTemplateRow, deleteTemplateVersion, insertTemplateEvent, insertTemplateWeek,
  shiftTemplateWeek, updateTemplateRow,
} from "@/app/(app)/admin/calendrier/actions";
import { parseLabelBounds } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const EVENT_TYPES = ["evaluation", "examen", "revision", "vacances", "detente"] as const;
const EVENT_TYPE_LABELS: Record<string, string> = {
  evaluation: "Évaluation", examen: "Examen", revision: "Révision",
  vacances: "Vacances", detente: "Détente",
};

/** ISO date (yyyy-mm-dd from <input type="date">) → DD/MM/YYYY label bound. */
function isoToFr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** RowEditor: the side-panel edit form. Keyed by the row's identity + data so
 *  the fields re-initialize whenever the row changes (selection or refresh). */
function RowEditor({
  row, busy, onSave, onShift, onInsertWeek, onInsertEvent, onDelete,
}: {
  row: Row;
  busy: boolean;
  onSave: (fields: { start: string; end: string; periode: string; eventType: string }) => Promise<string | null>;
  onShift: (deltaDays: number) => void;
  onInsertWeek: () => void;
  onInsertEvent: (label: string, type: string, startIso: string, endIso: string) => void;
  onDelete: () => void;
}) {
  const bounds = parseLabelBounds(row.date_label);
  const toIso = (d?: Date) =>
    d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
  const [start, setStart] = useState(toIso(bounds.start));
  const [end, setEnd] = useState(toIso(bounds.end));
  const [periode, setPeriode] = useState(row.periode_label ?? "");
  const [eventType, setEventType] = useState(row.row_type === "enseignement" ? "evaluation" : (row.evenement_label ?? "evaluation"));
  const [eventOpen, setEventOpen] = useState(false);
  const [evLabel, setEvLabel] = useState("Évaluation");
  const [evType, setEvType] = useState("evaluation");
  // default = the anchor week's Monday (single-day, previous behavior), editable
  const defaultEvIso = (() => {
    const b = parseLabelBounds(row.date_label);
    const d = b.start ?? new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [evStart, setEvStart] = useState(defaultEvIso);
  const [evEnd, setEvEnd] = useState(defaultEvIso);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const isWeek = row.row_type === "enseignement";

  async function save() {
    setLocalErr(null);
    if (!start || !end) { setLocalErr("Renseignez les deux dates."); return; }
    if (start > end) { setLocalErr("La date de début doit précéder la date de fin."); return; }
    const err = await onSave({ start, end, periode, eventType });
    if (err) setLocalErr(err);
  }

  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-500">N°</span>
        <span className="font-semibold">{isWeek ? `S${row.semaine_num}` : "—"}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Début</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
        </div>
        <div>
          <Label>Fin</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
        </div>
      </div>

      <div>
        <Label>Période</Label>
        <Input value={periode} onChange={(e) => setPeriode(e.target.value)} placeholder="— " disabled={busy} />
      </div>

      {!isWeek && (
        <div>
          <Label>Type</Label>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            disabled={busy}
          >
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      )}

      {(localErr) && <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{localErr}</div>}

      <Button className="w-full" onClick={save} disabled={busy}>{busy ? "…" : "Enregistrer"}</Button>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => onShift(-1)} disabled={busy} title="Décale toutes les lignes suivantes">− 1 j</Button>
        <Button variant="outline" className="flex-1" onClick={() => onShift(1)} disabled={busy} title="Décale toutes les lignes suivantes">+ 1 j</Button>
      </div>
      <p className="-mt-1 text-[10px] text-slate-400">± 1 j décale toutes les lignes suivantes.</p>

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-2">
        <Button variant="outline" onClick={onInsertWeek} disabled={busy}>Insérer une semaine</Button>
        {!eventOpen ? (
          <Button variant="outline" onClick={() => setEventOpen(true)} disabled={busy}>Insérer un événement</Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 p-2">
            <Input value={evLabel} onChange={(e) => setEvLabel(e.target.value)} placeholder="Libellé" disabled={busy} />
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={evType} onChange={(e) => setEvType(e.target.value)} disabled={busy}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Début</Label>
                <Input type="date" value={evStart} onChange={(e) => setEvStart(e.target.value)} disabled={busy} />
              </div>
              <div>
                <Label>Fin</Label>
                <Input type="date" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} disabled={busy} />
              </div>
            </div>
            {evErr && <p className="text-[10px] text-red-600">{evErr}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => {
                if (!evStart || !evEnd) { setEvErr("Renseignez les deux dates."); return; }
                if (evStart > evEnd) { setEvErr("La date de début doit précéder la date de fin."); return; }
                setEventOpen(false);
                onInsertEvent(evLabel, evType, evStart, evEnd);
              }} disabled={busy || !evLabel.trim()}>Insérer</Button>
              <Button variant="outline" onClick={() => setEventOpen(false)} disabled={busy}>Annuler</Button>
            </div>
          </div>
        )}
        <Button
          variant="outline"
          className="border-red-200 text-red-600 hover:bg-red-50"
          onClick={() => {
            if (confirm(isWeek
              ? `Supprimer la semaine S${row.semaine_num} ? Les semaines suivantes avancent d'une semaine.`
              : "Supprimer cet événement ?")) onDelete();
          }}
          disabled={busy}
        >
          Supprimer
        </Button>
      </div>
    </div>
  );
}
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

/** Pale wash color for days inside an event's range (harmonized with rowColor). */
function eventWash(type: string): string {
  if (type === "evaluation") return "#f3e8ff"; // purple-100
  if (type === "examen") return "#fee2e2";     // red-100
  if (type === "revision") return "#fef3c7";   // amber-100
  return "#fef9c3";                            // yellow-100 (vacances/detente)
}

/** First month (0-indexed) containing a dated row — the grid's entry point.
 *  Falls back to Sept 2026 (legacy default) when the model has no rows yet. */
function firstRowMonth(rows: Row[]): { y: number; m: number } {
  for (const r of rows) {
    const { start } = parseLabelBounds(r.date_label);
    if (start) return { y: start.getFullYear(), m: start.getMonth() };
  }
  return { y: 2026, m: 8 };
}

export function CalendarManager({
  yearLabel, section, versions, selectedVersionId, rows,
}: {
  yearLabel: string;
  section: "primaire" | "secondaire";
  versions: { id: string; version: number; is_active: boolean }[];
  selectedVersionId: string | null;
  rows: Row[];
}) {
  const router = useRouter();
  // The month grid follows the displayed model: start on the month of its
  // first dated row (a 2027–2028 draft must not open on Sept 2026, where none
  // of its weeks or events would be visible).
  const [viewYear, setViewYear] = useState(() => firstRowMonth(rows).y);
  const [viewMonth, setViewMonth] = useState(() => firstRowMonth(rows).m);
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Version switches re-render this same component instance with new props —
  // jump to the new version's first month and drop the stale row selection.
  const [shownVersionId, setShownVersionId] = useState(selectedVersionId);
  if (shownVersionId !== selectedVersionId) {
    setShownVersionId(selectedVersionId);
    const v = firstRowMonth(rows);
    setViewYear(v.y);
    setViewMonth(v.m);
    setSelected(null);
  }

  const sectionLabel = section === "primaire" ? "Primaire" : "Secondaire";
  const activeVersion = versions.find((v) => v.is_active);
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  function switchSection(s: string) {
    router.push(`/admin/calendrier?section=${s}`);
  }

  function switchVersion(v: string) {
    router.push(`/admin/calendrier?section=${section}&v=${v}`);
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
    const washByDate = new Map<string, Row[]>();
    for (const r of rows) {
      // date_label like "01/09/2026 → 04/09/2026"
      const m = r.date_label?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m && r.row_type === "enseignement") {
        const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
        const arr = rowsByDate.get(key) ?? [];
        arr.push(r); rowsByDate.set(key, arr);
      }
      // event rows: chip on the start date + a wash entry for EVERY day in the range
      if (m && r.row_type === "evenement") {
        const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
        const arr = rowsByDate.get(key) ?? [];
        arr.push(r); rowsByDate.set(key, arr);

        // Index the full span for the colored wash (works across month boundaries:
        // the lookup is by absolute date, so a wash can continue into the next view).
        const bounds = parseLabelBounds(r.date_label);
        if (bounds.start && bounds.end) {
          const cur = new Date(bounds.start);
          const end = bounds.end;
          // Safety bound (365 days) against malformed labels (end << start).
          for (let i = 0; i < 366 && cur <= end; i++) {
            const wk = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
            const wash = washByDate.get(wk) ?? [];
            wash.push(r);
            washByDate.set(wk, wash);
            cur.setDate(cur.getDate() + 1);
          }
        }
      }
    }

    return { cells, rowsByDate, washByDate, daysInMonth };
  }, [viewYear, viewMonth, rows]);

  // Grid row index (Mon-first) of the selected week, or null when nothing is
  // selected or the row's start date isn't visible in the current month view.
  // The frame anchors on the grid ROW containing the selected row's start date;
  // the Mon–Fri span covers that entire calendar row (a calendar row IS a week).
  const selectedWeekRow = useMemo(() => {
    if (!selected) return null;
    const m = selected.date_label?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    const start = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const idx = grid.cells.findIndex(
      (c) =>
        c.date.getFullYear() === start.getFullYear() &&
        c.date.getMonth() === start.getMonth() &&
        c.date.getDate() === start.getDate()
    );
    return idx >= 0 ? Math.floor(idx / 7) : null;
  }, [selected, grid]);

  // --- Row-editing handlers (Task 3) ---

  /** Shared wrapper: guard on the selected version (active or draft), busy flag, error surface.
   *  After success: router.refresh() re-runs the page server component, which
   *  re-reads template_rows from the DB — required because revalidatePath alone
   *  does not refetch for an already-mounted client component tree in all cases. */
  async function runEdit(fn: () => Promise<{ error?: string }>): Promise<boolean> {
    if (!selectedVersion) { setError("Aucun modèle à éditer."); return false; }
    setBusy(true); setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) { setError(res.error); return false; }
    router.refresh();
    return true;
  }

  function handleSave(row: Row, fields: { start: string; end: string; periode: string; eventType: string }) {
    return runEdit(() =>
      updateTemplateRow({
        templateVersionId: selectedVersion!.id,
        rowId: row.id,
        patch: {
          date_label: `${isoToFr(fields.start)} → ${isoToFr(fields.end)}`,
          periode_label: fields.periode.trim() || null,
          evenement_label: row.row_type === "enseignement" ? undefined : fields.eventType,
        },
      })
    ).then((ok) => (ok ? null : "Échec de l'enregistrement."));
  }

  async function handleShift(row: Row, deltaDays: number) {
    await runEdit(() =>
      shiftTemplateWeek({ templateVersionId: selectedVersion!.id, rowId: row.id, deltaDays })
    );
  }

  async function handleInsertWeek(row: Row) {
    const ok = await runEdit(() =>
      insertTemplateWeek({ templateVersionId: selectedVersion!.id, afterRowId: row.id })
    );
    if (ok) setSelected(null); // new row visible in the grid; panel resets
  }

  async function handleInsertEvent(row: Row, label: string, type: string, startIso: string, endIso: string) {
    const ok = await runEdit(() =>
      insertTemplateEvent({ templateVersionId: selectedVersion!.id, afterRowId: row.id, label, type, startIso, endIso })
    );
    if (ok) setSelected(null);
  }

  async function handleDelete(row: Row) {
    const ok = await runEdit(() =>
      deleteTemplateRow({ templateVersionId: selectedVersion!.id, rowId: row.id })
    );
    if (ok) setSelected(null); // no stale panel on a deleted row
  }

  async function handleDeleteVersion() {
    if (!selectedVersion || selectedVersion.is_active) return;
    if (!confirm(
      `Supprimer le brouillon v${selectedVersion.version} ? ` +
      `Ses ${rows.length} ligne${rows.length > 1 ? "s" : ""} seront définitivement supprimées.`
    )) return;
    const ok = await runEdit(() =>
      deleteTemplateVersion({ templateVersionId: selectedVersion.id })
    );
    // Land back on the default selection (active, else newest) — the deleted
    // draft no longer exists, so staying on ?v=<id> would show an empty model.
    if (ok) router.push(`/admin/calendrier?section=${section}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendrier · {sectionLabel}</h1>
          <p className="text-sm text-slate-500">
            Année {yearLabel}
            {selectedVersion
              ? ` · Modèle v${selectedVersion.version}${selectedVersion.is_active ? " (actif)" : " (brouillon)"}`
              : " · aucun modèle généré"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeVersion && !selectedVersion?.is_active && (
            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold text-amber-800 bg-amber-100">
              brouillon · v{activeVersion.version} active
            </span>
          )}
          {versions.length > 1 && (
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={selectedVersionId ?? ""}
              onChange={(e) => switchVersion(e.target.value)}
              title="Changer de version"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}{v.is_active ? " (active)" : " (brouillon)"}
                </option>
              ))}
            </select>
          )}
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={section}
            onChange={(e) => switchSection(e.target.value)}
          >
            <option value="primaire">Primaire</option>
            <option value="secondaire">Secondaire</option>
          </select>
          <Button onClick={() => router.push(`/admin/calendrier/generer?section=${section}`)}><span className="mr-1">+</span> Générer le calendrier</Button>
          {selectedVersion && !selectedVersion.is_active && (
            <>
              <Button
                variant="outline"
                title="Rouvrir l'assistant pré-rempli avec les dates et événements de ce brouillon"
                onClick={() => router.push(`/admin/calendrier/generer?section=${section}&resume=${selectedVersion.id}`)}
              >
                Reprendre la création
              </Button>
              <Button
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50"
                title="Supprimer définitivement ce brouillon et ses lignes"
                onClick={handleDeleteVersion}
              >
                Supprimer le brouillon
              </Button>
            </>
          )}
        </div>
      </div>

      {!selectedVersion && versions.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Aucun modèle pour {sectionLabel} · {yearLabel}. Cliquez « Générer le calendrier » pour créer les semaines.
        </div>
      )}

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

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
            {grid.cells.map((c, idx) => {
              const key = `${c.date.getFullYear()}-${c.date.getMonth()}-${c.date.getDate()}`;
              const dayRows = grid.rowsByDate.get(key) ?? [];
              // Event wash: every day inside an event's range gets a pale tint
              // of the event's color (full label on hover). Inline style wins
              // over Tailwind bg classes, so the wash also shows on the grey
              // adjacent-month cells.
              const washes = grid.washByDate.get(key) ?? [];
              const washStyle = washes.length
                ? { backgroundColor: eventWash(washes[washes.length - 1].evenement_label ?? "vacances") }
                : undefined;
              const washTitle = washes.length
                ? washes.map((w) => w.periode_label ?? "").filter(Boolean).join(" · ")
                : undefined;
              // Option B selection: continuous frame around the selected school
              // week (Mon–Fri of the row containing the selected week's Monday).
              const col = idx % 7;
              const rowIdx = Math.floor(idx / 7);
              const inSelectedWeek =
                selectedWeekRow !== null &&
                rowIdx === selectedWeekRow &&
                col <= 4; // Mon–Fri only
              const frameCls = !inSelectedWeek
                ? ""
                : col === 0
                  ? "week-frame-first"
                  : col === 4
                    ? "week-frame-last"
                    : "week-frame-mid";
              return (
                <div
                  key={c.key}
                  className={`min-h-[72px] bg-white p-1 ${c.inMonth ? "" : "bg-slate-50 text-slate-400"} ${frameCls}`}
                  style={washStyle}
                  title={washTitle}
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

        {/* Side panel: edit form keyed by row id so it re-initializes on selection change */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">Semaine sélectionnée</h3>
          {selected ? (
            <RowEditor
              key={selected.id}
              row={selected}
              busy={busy}
              onSave={(fields) => handleSave(selected, fields)}
              onShift={(d) => handleShift(selected, d)}
              onInsertWeek={() => handleInsertWeek(selected)}
              onInsertEvent={(label, type, startIso, endIso) => handleInsertEvent(selected, label, type, startIso, endIso)}
              onDelete={() => handleDelete(selected)}
            />
          ) : (
            <p className="mt-3 text-sm text-slate-400">Cliquez sur une semaine ou un événement du calendrier.</p>
          )}
        </div>
      </div>

    </div>
  );
}
