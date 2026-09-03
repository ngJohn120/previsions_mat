"use client";

// Data-safety guards: warn before unload when unsynced ops exist.

export type UnsyncedCheck = () => boolean | Promise<boolean>;

const listeners = new Set<UnsyncedCheck>();

/** Register a function returning true when there are unsynced ops. */
export function registerUnsyncedCheck(fn: UnsyncedCheck): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function anyUnsynced(): boolean {
  for (const fn of listeners) {
    let v = false;
    try {
      v = !!fn();
    } catch {
      v = true; // be safe
    }
    if (v) return true;
  }
  return false;
}

export function installBeforeUnload(): () => void {
  function handler(e: BeforeUnloadEvent) {
    if (!anyUnsynced()) return;
    e.preventDefault();
    // Legacy: required by some browsers to show the native dialog
    e.returnValue = "";
  }
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
