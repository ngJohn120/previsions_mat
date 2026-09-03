"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EditorDocHeader } from "@/components/editor/doc-header";
import { PrimaryGrid } from "@/components/editor/primary-grid";
import { SecondaryGrid } from "@/components/editor/secondary-grid";
import { Button } from "@/components/ui/button";
import { approveUnlockRequest, refuseUnlockRequest, type PendingUnlock } from "@/app/(app)/admin/unlock-actions";
import type { FicheWithRows } from "@/lib/fiche-types";

/**
 * Read-only fiche view (consultation). For admins, shows pending unlock
 * requests with Approve / Refuse.
 */
export function FicheReadOnly({
  data,
  viewerIsAdmin,
  pendingRequests,
}: {
  data: FicheWithRows;
  viewerIsAdmin: boolean;
  pendingRequests: PendingUnlock[];
}) {
  const router = useRouter();
  const { fiche, meta, rows } = data;
  const section = meta.section;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(requestId: string, approve: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = approve
      ? await approveUnlockRequest(requestId, section)
      : await refuseUnlockRequest(requestId, section);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNotice(approve ? "Réouverture approuvée — la fiche est de nouveau modifiable." : "Demande refusée.");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/enseignant" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← Retour
        </Link>
        <div className="flex-1" />
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Consultation · lecture seule
        </span>
      </div>

      {pendingRequests.length > 0 && viewerIsAdmin && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-900">
            Demande{pendingRequests.length > 1 ? "s" : ""} de réouverture en attente
          </h3>
          {pendingRequests.map((r) => (
            <div key={r.id} className="mt-2 rounded-lg bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-700">
                  {r.demandeur?.full_name ?? "Enseignant"}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(r.created_at).toLocaleString("fr-FR")}
                </span>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={() => decide(r.id, false)} disabled={busy}>
                  Refuser
                </Button>
                <Button size="sm" onClick={() => decide(r.id, true)} disabled={busy}>
                  Approuver la réouverture
                </Button>
              </div>
              <p className="mt-1.5 text-slate-600">« {r.motif} »</p>
            </div>
          ))}
        </div>
      )}

      {notice && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mx-auto max-w-[1560px] space-y-4">
        <EditorDocHeader
          section={section}
          classe={meta.classe}
          titulaireLabel={meta.enseignant}
          branche={meta.cours}
          sousBranche={meta.sous_branche}
          yearLabel={meta.school_year_label}
        />

        {fiche.statut === "soumise" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
            Fiche <strong>soumise</strong> le {fiche.submitted_at ? new Date(fiche.submitted_at).toLocaleDateString("fr-FR") : "—"}.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {section === "primaire" ? (
            <PrimaryGrid rows={rows} editable={false} />
          ) : (
            <SecondaryGrid rows={rows} editable={false} />
          )}
        </div>
      </div>
    </div>
  );
}
