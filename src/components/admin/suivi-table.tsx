"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { approveUnlockRequest, refuseUnlockRequest } from "@/app/(app)/admin/unlock-actions";
import type { SuiviFicheRow, UnlockRequestWithContext } from "@/lib/fiche";
import type { Section } from "@/lib/auth";

type Tab = "all" | "soumises" | "demandes" | "conflits";

function EtatChip({ row }: { row: SuiviFicheRow }) {
  if (row.conflit)
    return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Conflit</Badge>;
  if (row.hasPendingUnlock)
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Demande</Badge>;
  if (row.statut === "soumise")
    return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Soumise</Badge>;
  return <Badge variant="secondary" className="bg-slate-100 text-slate-600">Brouillon</Badge>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function SuiviTable({
  yearId,
  yearLabel,
  sections,
  initialFiches,
  initialRequests,
}: {
  yearId: string;
  yearLabel: string;
  sections: Section[];
  initialFiches: SuiviFicheRow[];
  initialRequests: UnlockRequestWithContext[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [classeFilter, setClasseFilter] = useState("all");
  const [etatFilter, setEtatFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const sectionLabel = sections.length === 1
    ? sections[0] === "primaire" ? "Primaire" : "Secondaire"
    : "Toutes sections";

  const stats = useMemo(() => {
    const total = initialFiches.length;
    const soumises = initialFiches.filter((f) => f.statut === "soumise" && !f.hasPendingUnlock).length;
    const brouillons = initialFiches.filter((f) => f.statut === "brouillon" && !f.conflit && !f.hasPendingUnlock).length;
    const demandes = initialRequests.length;
    const conflits = initialFiches.filter((f) => f.conflit).length;
    return { total, soumises, brouillons, demandes, conflits };
  }, [initialFiches, initialRequests]);

  const classes = useMemo(
    () => Array.from(new Set(initialFiches.map((f) => f.classe))).sort(),
    [initialFiches]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initialFiches.filter((f) => {
      if (tab === "soumises" && !(f.statut === "soumise" && !f.hasPendingUnlock)) return false;
      if (tab === "demandes" && !f.hasPendingUnlock) return false;
      if (tab === "conflits" && !f.conflit) return false;
      if (classeFilter !== "all" && f.classe !== classeFilter) return false;
      if (etatFilter === "soumise" && !(f.statut === "soumise" && !f.hasPendingUnlock)) return false;
      if (etatFilter === "brouillon" && !(f.statut === "brouillon" && !f.conflit && !f.hasPendingUnlock)) return false;
      if (etatFilter === "conflit" && !f.conflit) return false;
      if (etatFilter === "demande" && !f.hasPendingUnlock) return false;
      if (needle) {
        const hay = `${f.classe} ${f.cours} ${f.sousBranche ?? ""} ${f.enseignant}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [initialFiches, tab, q, classeFilter, etatFilter]);

  async function decide(reqId: string, approve: boolean, section: Section) {
    setBusy(true);
    const res = approve
      ? await approveUnlockRequest(reqId, section)
      : await refuseUnlockRequest(reqId, section);
    setBusy(false);
    if (res.error) alert(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suivi des prévisions annuelles</h1>
          <p className="text-sm text-slate-500">
            {sectionLabel} · Année {yearLabel} — supervisez soumissions, demandes et conflits
          </p>
        </div>
        <a
          href={`/admin/export?yearId=${encodeURIComponent(yearId)}`}
          className="inline-flex h-7 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Exporter (CSV)
        </a>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Fiches" value={stats.total} foot={sectionLabel} />
        <Stat label="Soumises" value={stats.soumises} foot={`${stats.total ? Math.round((stats.soumises / stats.total) * 100) : 0} % de la section`} />
        <Stat label="Brouillons" value={stats.brouillons} foot="En cours" />
        <Stat label="Demandes" value={stats.demandes} foot="Réouvertures en attente" warn />
        <Stat label="Conflits" value={stats.conflits} foot="À résoudre" danger />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["all", `Toutes les fiches (${stats.total})`],
            ["soumises", `Soumissions récentes (${stats.soumises})`],
            ["demandes", `Demandes de réouverture (${stats.demandes})`],
            ["conflits", `Conflits (${stats.conflits})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher classe, cours, enseignant…"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
        />
        <select value={classeFilter} onChange={(e) => setClasseFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600">
          <option value="all">Toutes les classes</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={etatFilter} onChange={(e) => setEtatFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600">
          <option value="all">Tous les états</option>
          <option value="brouillon">Brouillon</option>
          <option value="soumise">Soumise</option>
          <option value="demande">Demande</option>
          <option value="conflit">Conflit</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{visible.length} fiche(s) affichée(s)</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Classe</th>
                <th className="px-4 py-3">Cours</th>
                <th className="px-4 py-3">Sous-branche</th>
                <th className="px-4 py-3">Enseignant</th>
                <th className="px-4 py-3">État</th>
                <th className="px-4 py-3">Progression</th>
                <th className="px-4 py-3">Soumise le</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((f) => (
                <tr key={f.ficheId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{f.classe}</td>
                  <td className="px-4 py-3">{f.cours}</td>
                  <td className="px-4 py-3 text-slate-500">{f.sousBranche ?? "—"}</td>
                  <td className="px-4 py-3">{f.enseignant}</td>
                  <td className="px-4 py-3"><EtatChip row={f} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${f.progression}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{f.progression} %</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(f.submittedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => router.push(`/fiche/${f.ficheId}/consultation`)}>
                      Consulter
                    </Button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Aucune fiche pour ces filtres.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Requests panel */}
      {initialRequests.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
            Demandes de réouverture
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{initialRequests.length}</Badge>
          </h3>
          <div className="divide-y divide-slate-100">
            {initialRequests.map((r) => {
              const sec = r.fiche?.attribution?.classe?.section ?? "primaire";
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-[220px] flex-1">
                    <div className="text-sm font-semibold text-slate-800">
                      {r.fiche?.attribution?.branche?.name ?? "—"} · {r.fiche?.attribution?.classe?.name ?? "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.fiche?.attribution?.enseignant?.full_name ?? "—"} · soumise le {fmtDate(r.fiche?.submitted_at ?? null)}
                    </div>
                    <div className="text-xs text-slate-400">« {r.motif} »</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => router.push(`/fiche/${r.fiche?.id}/consultation`)}>Consulter</Button>
                  <Button variant="outline" size="sm" className="text-red-600" disabled={busy} onClick={() => decide(r.id, false, sec)}>Refuser</Button>
                  <Button size="sm" disabled={busy} onClick={() => decide(r.id, true, sec)}>Approuver</Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, foot, warn, danger }: { label: string; value: number | string; foot?: string; warn?: boolean; danger?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? "text-red-600" : warn ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
      {foot && <div className="mt-1 text-xs text-slate-400">{foot}</div>}
    </Card>
  );
}
