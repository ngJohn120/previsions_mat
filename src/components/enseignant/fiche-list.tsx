"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemandeModificationDialog } from "@/components/enseignant/demande-modification-dialog";
import { ConflitDialog } from "@/components/enseignant/conflit-dialog";
import { exportFichesCsv } from "@/app/(app)/enseignant/actions";
import type { FicheListItemData, FicheStatut } from "@/lib/fiche-types";
import { EyeIcon, PencilIcon, TriangleAlertIcon, UnlockIcon } from "lucide-react";
import { RowAction } from "@/components/ui/row-action";

export type FicheListItem = FicheListItemData;

export function statusChip(statut: FicheStatut, conflit: boolean) {
  if (conflit)
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Conflit</Badge>;
  if (statut === "soumise")
    return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Soumise</Badge>;
  return <Badge variant="secondary" className="bg-slate-100 text-slate-600">Brouillon</Badge>;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) +
    (d.toDateString() === new Date().toDateString()
      ? `, ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : "");
}

export function FicheList({
  yearId,
  yearLabel,
  userName,
  viewerIsAdmin,
  initialFiches,
}: {
  yearId: string;
  yearLabel: string;
  userName: string;
  viewerIsAdmin: boolean;
  initialFiches: FicheListItem[];
}) {
  const router = useRouter();
  const [classeFilter, setClasseFilter] = useState("all");
  const [etatFilter, setEtatFilter] = useState("all");
  const [demandeFor, setDemandeFor] = useState<FicheListItem | null>(null);
  const [conflitFor, setConflitFor] = useState<FicheListItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const stats = useMemo(() => {
    const total = initialFiches.length;
    const brouillons = initialFiches.filter(
      (f) => f.statut === "brouillon" && !f.conflit && !f.hasPendingUnlock
    ).length;
    const soumises = initialFiches.filter((f) => f.statut === "soumise" && !f.hasPendingUnlock).length;
    const demandes = initialFiches.filter((f) => f.hasPendingUnlock).length;
    const conflits = initialFiches.filter((f) => f.conflit).length;
    const aCompleter = initialFiches.filter((f) => f.statut === "brouillon" && !f.conflit && f.progression < 100).length;
    const avg = total ? Math.round(initialFiches.reduce((s, f) => s + f.progression, 0) / total) : 0;
    return { total, brouillons, soumises, demandes, conflits, aCompleter, avg };
  }, [initialFiches]);

  const classes = useMemo(
    () => Array.from(new Set(initialFiches.map((f) => f.classe))).sort(),
    [initialFiches]
  );

  const filtered = useMemo(
    () =>
      initialFiches.filter(
        (f) =>
          (classeFilter === "all" || f.classe === classeFilter) &&
          (etatFilter === "all" ||
            (etatFilter === "conflit" && f.conflit) ||
            (etatFilter === "demande" && f.hasPendingUnlock) ||
            (etatFilter === "soumise" && f.statut === "soumise" && !f.hasPendingUnlock) ||
            (etatFilter === "brouillon" && f.statut === "brouillon" && !f.conflit && !f.hasPendingUnlock))
      ),
    [initialFiches, classeFilter, etatFilter]
  );

  const hasConflict = stats.conflits > 0;
  const hasPending = stats.demandes > 0;

  async function doExport() {
    setExporting(true);
    const res = await exportFichesCsv();
    setExporting(false);
    if (res.error || !res.csv) {
      alert(res.error ?? "Export impossible");
      return;
    }
    const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename ?? "mes-fiches.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {hasConflict && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">{stats.conflits} conflit{stats.conflits > 1 ? "s" : ""}</span>
          <span className="flex-1 min-w-[200px]">Des cases ont été modifiées sur plusieurs appareils. À résoudre avant soumission.</span>
        </div>
      )}
      {hasPending && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Demande de déverrouillage en attente</span>
          <span className="flex-1 min-w-[200px]">Un administrateur doit approuver la réouverture avant modification.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {viewerIsAdmin ? "Fiches de la section" : `Bonjour, ${userName.split(" ")[0] || userName} 👋`}
          </h1>
          <p className="text-sm text-slate-500">
            {viewerIsAdmin ? "Toutes les fiches accessibles" : "Mes prévisions annuelles"} · Année {yearLabel}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={doExport} disabled={exporting}>
          {exporting ? "Export…" : "Exporter la liste (CSV)"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Mes fiches" value={String(stats.total)} foot={`${stats.aCompleter} à compléter`} />
        <StatCard label="Brouillons" value={String(stats.brouillons)} foot="En cours de remplissage" />
        <StatCard label="Soumises" value={String(stats.soumises)} foot="En attente de validation" />
        <StatCard label="Demandes" value={String(stats.demandes)} foot="Réouverture en attente" />
        <StatCard label="Progression" value={`${stats.avg} %`} foot="Moyenne globale" accent />
      </div>

      {/* Table */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <strong className="px-1 text-sm text-slate-700">Fiches</strong>
          <div className="flex-1" />
          <select
            value={classeFilter}
            onChange={(e) => setClasseFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600"
          >
            <option value="all">Toutes les classes</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={etatFilter}
            onChange={(e) => setEtatFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600"
          >
            <option value="all">Tous les états</option>
            <option value="brouillon">Brouillon</option>
            <option value="soumise">Soumise</option>
            <option value="demande">Demande</option>
            <option value="conflit">Conflit</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Classe</th>
                <th className="px-4 py-3">Matière</th>
                <th className="px-4 py-3">Sous-branche</th>
                <th className="px-4 py-3">État</th>
                <th className="px-4 py-3">Progression</th>
                <th className="px-4 py-3">Dernière modif.</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((f) => (
                <tr key={f.ficheId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{f.classe}</td>
                  <td className="px-4 py-3">{f.cours}</td>
                  <td className="px-4 py-3 text-slate-500">{f.sousBranche ?? "—"}</td>
                  <td className="px-4 py-3">{statusChip(f.statut, f.conflit)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${f.progression}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{f.progression} %</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtWhen(f.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      {f.conflit ? (
                        <RowAction label="Résoudre le conflit" tone="danger" onClick={() => setConflitFor(f)}>
                          <TriangleAlertIcon />
                        </RowAction>
                      ) : f.statut === "brouillon" ? (
                        <RowAction label="Ouvrir la fiche" onClick={() => router.push(`/fiche/${f.ficheId}`)}>
                          <PencilIcon />
                        </RowAction>
                      ) : (
                        <>
                          <RowAction label="Consulter" onClick={() => router.push(`/fiche/${f.ficheId}/consultation`)}>
                            <EyeIcon />
                          </RowAction>
                          {!f.hasPendingUnlock && (
                            <RowAction label="Demander modification" onClick={() => setDemandeFor(f)}>
                              <UnlockIcon />
                            </RowAction>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    {initialFiches.length === 0
                      ? "Aucune fiche à afficher car vous n'avez aucun cours"
                      : "Aucune fiche pour ces filtres."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {demandeFor && (
        <DemandeModificationDialog
          fiche={demandeFor}
          onClose={() => setDemandeFor(null)}
          onDone={() => { setDemandeFor(null); router.refresh(); }}
        />
      )}
      {conflitFor && (
        <ConflitDialog fiche={conflitFor} onClose={() => setConflitFor(null)} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  foot,
  accent,
}: {
  label: string;
  value: string;
  foot?: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-blue-700" : "text-slate-900"}`}>{value}</div>
      {foot && <div className="mt-1 text-xs text-slate-400">{foot}</div>}
    </Card>
  );
}
