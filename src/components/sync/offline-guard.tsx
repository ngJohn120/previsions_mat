"use client";

// App-wide offline/sync guard: auto-resume + unsynced banner + beforeunload.
import { useEffect } from "react";
import { installBeforeUnload } from "@/lib/sync/guards";
import { useSyncResume } from "@/lib/sync/use-sync-resume";

export function OfflineGuard() {
  const { state, pending } = useSyncResume();

  // Install beforeunload warning as soon as the guard mounts.
  useEffect(() => {
    return installBeforeUnload();
  }, []);

  if (state.kind === "resuming") {
    return (
      <div className="sticky top-0 z-40 border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-center text-xs font-medium text-blue-800">
        Reprise de la synchronisation… {pending > 0 ? `(${pending} en attente)` : ""}
      </div>
    );
  }
  if (state.kind === "offline") {
    return (
      <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-800">
        Hors ligne — vos modifications sont enregistrées localement et seront synchronisées au retour du réseau.
      </div>
    );
  }
  return null;
}
