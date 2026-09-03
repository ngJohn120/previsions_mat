"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(app)/notifications/actions";
import type { NotificationItem } from "@/app/(app)/notifications/actions";

const META: Record<string, { ico: string; label: string; chip: string }> = {
  fiche_soumise: { ico: "✓", label: "Fiche soumise", chip: "bg-blue-100 text-blue-700" },
  demande_reouverture: { ico: "!", label: "Demande de réouverture", chip: "bg-amber-100 text-amber-700" },
  demande_approuvee: { ico: "✓", label: "Réouverture approuvée", chip: "bg-green-100 text-green-700" },
  demande_refusee: { ico: "✕", label: "Réouverture refusée", chip: "bg-red-100 text-red-700" },
  conflit: { ico: "⚠", label: "Conflit détecté", chip: "bg-red-100 text-red-700" },
  nouveau_modele: { ico: "▤", label: "Nouveau modèle", chip: "bg-slate-100 text-slate-600" },
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "hier";
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString("fr-FR");
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const router = useRouter();
  const meta = (t: string) => META[t] ?? META.nouveau_modele;

  function actionHref(n: NotificationItem): string | null {
    const ficheId = n.payload?.ficheId as string | undefined;
    if (!ficheId) return null;
    if (n.type === "demande_reouverture" || n.type === "fiche_soumise") return `/fiche/${ficheId}/consultation`;
    if (n.type === "conflit") return `/fiche/${ficheId}/conflits`;
    return `/fiche/${ficheId}`;
  }

  function title(n: NotificationItem): string {
    const p = n.payload as Record<string, string | undefined>;
    const label = meta(n.type).label;
    const ctx = p?.cours || p?.classe || "";
    return ctx ? `${label} · ${ctx}` : label;
  }

  function detail(n: NotificationItem): string {
    const p = n.payload as Record<string, string | undefined>;
    if (n.type === "fiche_soumise" && p?.enseignant) return `${p.enseignant} a soumis sa prévision annuelle`;
    if (n.type === "demande_reouverture") return p?.motif ? `« ${p.motif} »` : "Demande en attente";
    if (n.type === "demande_approuvee") return "Votre fiche est de nouveau modifiable";
    if (n.type === "demande_refusee") return "Votre demande de réouverture a été refusée";
    if (n.type === "conflit") return "Deux appareils ont modifié la même case";
    return "";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Alertes nécessitant votre attention dans votre section
        </p>
        {items.some((n) => !n.read_at) && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await markAllNotificationsRead();
              router.refresh();
            }}
          >
            Tout marquer comme lu
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.length === 0 && (
          <div className="px-6 py-14 text-center text-sm text-slate-400">
            Aucune notification pour le moment.
          </div>
        )}
        {items.map((n) => {
          const m = meta(n.type);
          const unread = !n.read_at;
          const href = actionHref(n);
          return (
            <div
              key={n.id}
              className={`flex gap-3 border-b border-slate-100 px-4 py-3 last:border-0 ${unread ? "bg-blue-50/40" : ""}`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${m.chip}`}>
                {m.ico}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{title(n)}</span>
                  {unread && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                </div>
                <div className="text-xs text-slate-500">
                  {detail(n)} · {fmtTime(n.created_at)}
                </div>
                {href && (
                  <div className="mt-1.5">
                    <Button
                      variant={unread ? "default" : "outline"}
                      size="xs"
                      onClick={async () => {
                        if (unread) await markNotificationRead(n.id);
                        router.push(href);
                      }}
                    >
                      {n.type === "demande_reouverture" ? "Traiter la demande" : n.type === "conflit" ? "Résoudre" : "Consulter la fiche"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">💡 Les notifications sont internes à l'application (pas d'e-mail).</p>
    </div>
  );
}
