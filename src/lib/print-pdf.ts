import { spawn } from "node:child_process";
import path from "node:path";
import {
  createRendererEnvelope,
  toPdfPayload,
  type PdfPayload,
} from "@/lib/pdf-renderer-contract";
import type { FicheWithRows } from "@/lib/fiche-types";

export type PdfRendererMode = "local" | "vercel";

const PDF_ERROR = "Impossible de générer le PDF.";

/** Résout le mode de rendu : option explicite > env > Vercel/local. */
function resolveMode(
  options?: { mode?: PdfRendererMode }
): PdfRendererMode {
  if (options?.mode) return options.mode;
  const env = process.env.PDF_RENDERER_MODE as PdfRendererMode | undefined;
  if (env === "local" || env === "vercel") return env;
  return process.env.VERCEL ? "vercel" : "local";
}

async function renderViaVercel(payload: PdfPayload, origin: string): Promise<Buffer> {
  const secret = process.env.PDF_RENDERER_SECRET;
  if (!secret) {
    throw new Error("Configuration PDF indisponible.");
  }
  const { body, signature } = createRendererEnvelope(payload, secret);

  // Base URL explicite pour l'environnement local (vercel dev sert l'app et la
  // Function Python sur des ports différents). En production, l'origine de la
  // requête est l'origine publique de déploiement.
  const base = process.env.PDF_RENDERER_BASE_URL ?? origin;

  let res: Response;
  try {
    res = await fetch(new URL("/api/render_pdf", base), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prevision-Pdf-Signature": signature,
      },
      body,
      cache: "no-store",
    });
  } catch {
    throw new Error(PDF_ERROR);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("application/pdf")) {
    throw new Error(PDF_ERROR);
  }
  return Buffer.from(await res.arrayBuffer());
}

function renderViaLocalPython(payload: PdfPayload): Promise<Buffer> {
  const script = path.join(process.cwd(), "scripts", "rendu_pdf.py");
  const pythonBin = process.env.PYTHON_BIN ?? "python";
  const input = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script, "--payload-stdin", "--stdout"], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));

    child.on("error", (e) =>
      reject(new Error(`Impossible de lancer Python: ${e.message}`))
    );

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const msg = Buffer.concat(errChunks).toString("utf-8").trim();
        reject(new Error(msg || `Le script Python a échoué (code ${code}).`));
      }
    });

    child.stdin.on("error", () => {
      /* le processus peut fermer stdin avant la fin de l'écriture */
    });
    child.stdin.write(input, "utf-8");
    child.stdin.end();
  });
}

/**
 * Génère le PDF officiel d'une fiche déjà autorisée par RLS.
 *
 * `vercel` : enveloppe JSON signée (HMAC) → Vercel Python Function, sans
 *            aucun secret Supabase envoyé.
 * `local`  : payload imprimable → CLI Python locale (aucune lecture de base
 *            de données dans ce chemin).
 */
export async function generateFichePdf(
  fiche: FicheWithRows,
  origin: string,
  options?: { mode?: PdfRendererMode }
): Promise<Buffer> {
  const payload = toPdfPayload(fiche);
  const mode = resolveMode(options);
  if (mode === "vercel") {
    return renderViaVercel(payload, origin);
  }
  return renderViaLocalPython(payload);
}