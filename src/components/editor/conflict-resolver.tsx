"use client";

// Conflict resolver: side-by-side A/B with option to edit a C value.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listConflicts, removeConflict, putConflict } from "@/lib/db";
import { enqueue } from "@/lib/sync/outbox";
import { drainOutbox } from "@/lib/sync/outbox";
import { executeOp } from "@/lib/sync/transport";
import type { Conflict } from "@/lib/sync/types";
import type { FicheRow } from "@/lib/fiche-types";

const COL_LABELS: Record<string, string> = {
  matieres: "Matières à enseigner / prévues",
  ref: "Réf.",
  intention: "Intention",
  obs: "Obs.",
  heure: "Heure",
  mv: "M.V.",
};

export type ConflictVM = Conflict & {
  key: string;
  rowLabel: string;
  cellLabel: string;
  cellId: string | null;
  serverVersion: number | null;
};

function rowLabel(r: FicheRow | undefined): string {
  if (!r) return "Ligne inconnue";
  if (r.row_type === "evenement") return r.periode_label ?? "Événement";
  const s = r.semaine_num ? `Semaine ${r.semaine_num}` : "";
  const d = r.date_label ? ` (${r.date_label})` : "";
  return [s, d].filter(Boolean).join("") || "Ligne";
}

export function useConflicts(ficheId: string, rows: FicheRow[]) {
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState<ConflictVM[]>([]);

  // Reload conflicts from IndexedDB whenever tick/rows change
  useEffect(() => {
    let alive = true;
    listConflicts(ficheId).then((all) => {
      if (!alive) return;
      // One-time migration: records created before conflict timestamps existed
      // have no createdAt. Stamp them at first sight so every card shows a
      // detectable time; persist so it stays stable across reloads.
      const legacy = all.filter((c) => !c.createdAt);
      if (legacy.length > 0) {
        const now = Date.now();
        Promise.all(
          legacy.map((c) =>
            putConflict({ ...c, createdAt: now }, ficheId).catch(() => {})
          )
        ).then(() => {
          if (alive) setTick((v) => v + 1);
        });
      }
      const vm: ConflictVM[] = all.map((c) => {
        const row = rows.find((r) => r.row_uuid === c.rowUuid);
        const cell = row?.cells[c.cellKey];
        const cellId = cell?.id ?? null;
        return {
          ...c,
          key: c.key,
          rowLabel: rowLabel(row),
          cellLabel: COL_LABELS[c.cellKey] ?? c.cellKey,
          cellId,
          // Prefer the version captured at conflict time; fall back to the
          // currently rendered row's version.
          serverVersion: c.serverVersion ?? cell?.version ?? null,
          // Migration fallback so legacy (pre-timestamp) records still show
          // something in the card header.
          createdAt: c.createdAt ?? Date.now(),
        };
      });
      setLoaded(vm);
    });
    return () => {
      alive = false;
    };
  }, [ficheId, rows, tick]);

  // Refresh when the sync-resume layer detects a conflict on this fiche.
  useEffect(() => {
    function onConflictsChanged(e: Event) {
      const detail = (e as CustomEvent<{ ficheId?: string }>).detail;
      if (!detail?.ficheId || detail.ficheId === ficheId) setTick((v) => v + 1);
    }
    window.addEventListener("pm:conflicts-changed", onConflictsChanged);
    return () => window.removeEventListener("pm:conflicts-changed", onConflictsChanged);
  }, [ficheId]);

  return { conflicts: loaded, refresh: () => setTick((v) => v + 1) };
}

export function ConflictResolver({
  ficheId,
  conflicts,
  onResolved,
}: {
  ficheId: string;
  conflicts: ConflictVM[];
  onResolved?: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string | "A" | "B">>({});
  const [customs, setCustoms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (conflicts.length === 0) return null;

  async function resolveOne(c: ConflictVM): Promise<boolean> {
    const choice = choices[c.key];
    if (choice === undefined) return false;
    const value =
      choice === "A" ? c.localValue : choice === "B" ? c.serverValue : (customs[c.key] ?? "").trim();
    if (choice === "C" && !value) return false;

    // If we know the actual cell id, persist server-side (online path) via outbox
    if (c.cellId) {
      await enqueue({
        opId: `resolve:${c.cellId}:${Date.now()}`,
        kind: "set_cell",
        cellId: c.cellId,
        value,
        expectedVersion: c.serverVersion ?? 0,
        createdAt: Date.now(),
      });
    }
    await removeConflict(c.key);
    return true;
  }

  async function confirmAll() {
    setBusy(true);
    setError(null);
    try {
      for (const c of conflicts) {
        await resolveOne(c);
      }
      // Flush if online
      if (typeof navigator !== "undefined" && navigator.onLine) {
        await drainOutbox(async (op) => executeOp(op));
      }
      onResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la résolution");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-bold text-red-800">Conflits à résoudre ({conflicts.length})</span>
        <span className="text-xs text-red-600">Deux appareils ont modifié la même case. Choisissez la version à conserver.</span>
      </div>

      <div className="space-y-3">
        {conflicts.map((c) => (
          <div key={c.key} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
              <b className="text-slate-700">{c.rowLabel}</b>
              <span>·</span>
              {c.cellLabel}
              {c.createdAt && (
                <>
                  <span>·</span>
                  <span className="text-slate-400" title={`Détecté le ${new Date(c.createdAt).toLocaleString("fr-FR")}`}>
                    {new Date(c.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}{" "}
                    {new Date(c.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <VersionCard
                label="Version A"
                sub="Votre appareil"
                value={c.localValue}
                checked={choices[c.key] === "A"}
                onClick={() => setChoices((s) => ({ ...s, [c.key]: "A" }))}
              />
              <VersionCard
                label="Version B"
                sub="Autre appareil / serveur"
                value={c.serverValue}
                checked={choices[c.key] === "B"}
                onClick={() => setChoices((s) => ({ ...s, [c.key]: "B" }))}
              />
            </div>
            <label
              className={cn(
                "mt-2 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-sm",
                choices[c.key] === "C" ? "border-blue-300 bg-blue-50" : "border-slate-200"
              )}
            >
              <input
                type="radio"
                checked={choices[c.key] === "C"}
                onChange={() => setChoices((s) => ({ ...s, [c.key]: "C" }))}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-slate-600">Version C — saisir une autre valeur</span>
                {choices[c.key] === "C" && (
                  <input
                    value={customs[c.key] ?? ""}
                    onChange={(e) => setCustoms((s) => ({ ...s, [c.key]: e.target.value }))}
                    placeholder="Nouvelle valeur…"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-400"
                  />
                )}
              </span>
            </label>
          </div>
        ))}
      </div>

      {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setChoices({}); setCustoms({}); }}>
          Réinitialiser
        </Button>
        <Button size="sm" disabled={busy} onClick={confirmAll}>
          {busy ? "Enregistrement…" : "Confirmer les choix"}
        </Button>
      </div>
    </div>
  );
}

function VersionCard({
  label,
  sub,
  value,
  checked,
  onClick,
}: {
  label: string;
  sub: string;
  value: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-2 rounded-md border px-2.5 py-2 text-sm",
        checked ? "border-blue-300 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 hover:bg-slate-50"
      )}
    >
      <input type="radio" checked={checked} onChange={onClick} className="mt-1" />
      <span className="min-w-0">
        <span className="block text-xs font-bold text-slate-700">
          {label} <span className="font-normal text-slate-400">· {sub}</span>
        </span>
        <span className="mt-0.5 block whitespace-pre-wrap text-slate-600">{value || "—"}</span>
      </span>
    </label>
  );
}
