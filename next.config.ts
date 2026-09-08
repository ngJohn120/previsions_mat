import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * Dev-only: allow phones/tablets on the same LAN — or on the same Tailscale
 * tailnet — to load dev resources (HMR websocket, fonts, CSS). Next.js blocks
 * cross-origin dev requests by default; without this the interactive runtime
 * can fail to load over http://<LAN-IP>:3001 or http://<tailnet-host>:3001 —
 * exactly what "controls don't respond on the phone" looks like.
 *
 * Override with LOCAL_LAN_HOST=http://<host>:3001 (or just the host) in the
 * dev command. Default: every non-internal IPv4 plus the Tailscale MagicDNS
 * hostname of this machine (stable across pocket-router IP churn).
 */
function devOrigins(): string[] {
  const fromEnv = process.env.LOCAL_LAN_HOST;
  if (fromEnv) {
    const host = fromEnv.replace(/^https?:\/\//, "").split(":")[0];
    if (host) return [host];
  }
  const hosts = new Set<string>();
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) hosts.add(a.address);
    }
  }
  // Tailscale MagicDNS name for this machine (stable when LAN IP changes).
  const tsHost = process.env.TAILSCALE_HOST ?? "win-bmk95eskl4h.tail4649ee.ts.net";
  hosts.add(tsHost);
  return [...hosts];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
};

export default nextConfig;
