// Copies the exact installed pdfjs-dist worker into public/pdfjs/ so the
// browser loads the worker matching the library version. Runs from npm
// postinstall; the copy is idempotent.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const destDir = join(root, "public", "pdfjs");
const dest = join(destDir, "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.warn("[sync-pdfjs-worker] pdfjs-dist not installed yet — skipping");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[sync-pdfjs-worker] copied worker →", dest);
