"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js) once in the browser.
 * Only runs client-side, guarded for HTTPS/localhost.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Only register on secure contexts (https or localhost) — dev is localhost.
    if (!window.isSecureContext && !/^localhost$/.test(window.location.hostname)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: app still works online
    });
  }, []);
  return null;
}
