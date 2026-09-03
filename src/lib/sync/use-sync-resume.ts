"use client";

// Auto-resume: on app load, if the outbox is non-empty, drain pending ops
// and surface status (reprise… / synced) until empty.
import { useCallback, useEffect, useRef, useState } from "react";
import { countOutbox } from "@/lib/db";
import { drainOutbox } from "@/lib/sync/outbox";
import { executeOp } from "@/lib/sync/transport";
import { registerUnsyncedCheck } from "@/lib/sync/guards";
import type { SyncOp } from "@/lib/sync/types";

export type ResumeState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "resuming"; remaining: number }
  | { kind: "done" }
  | { kind: "offline" };

export function useSyncResume() {
  const [state, setState] = useState<ResumeState>({ kind: "idle" });
  const [pending, setPending] = useState(0);
  const running = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await countOutbox());
    } catch {
      setPending(0);
    }
  }, []);

  const resume = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const count = await countOutbox();
      if (count === 0) {
        setState({ kind: "done" });
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setState({ kind: "offline" });
        return;
      }
      setState({ kind: "resuming", remaining: count });
      const res = await drainOutbox(async (op: SyncOp) => executeOp(op));
      setPending(res.ok + res.failed + res.conflicts === 0 ? 0 : await countOutbox());
      setState({ kind: "done" });
    } catch {
      setState({ kind: "done" });
    } finally {
      running.current = false;
    }
  }, []);

  // Auto-resume on mount
  useEffect(() => {
    refreshPending();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState({ kind: "offline" });
      return;
    }
    resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pending fresh on online/offline changes
  useEffect(() => {
    const onOnline = () => {
      setState({ kind: "idle" });
      resume();
    };
    const onOffline = () => {
      setState({ kind: "offline" });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [resume]);

  // Register beforeunload check: warn when outbox has pending ops
  useEffect(() => {
    return registerUnsyncedCheck(() => pending > 0);
  }, [pending]);

  return { state, pending, resume };
}
