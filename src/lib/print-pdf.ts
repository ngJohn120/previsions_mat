import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Shell out to the local Python ReportLab renderer (scripts/rendu_pdf.py).
 *
 * Requires: python on PATH (or PYTHON_BIN) with reportlab + httpx (+ pypdfium2
 * for page images), and NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in
 * the env (the script reads .env.local itself; we pass cwd so it finds it).
 */
function runPython(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  const script = path.join(process.cwd(), "scripts", "rendu_pdf.py");
  const pythonBin = process.env.PYTHON_BIN ?? "python";

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
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
        resolve({ stdout: Buffer.concat(chunks), stderr: Buffer.concat(errChunks).toString("utf-8") });
      } else {
        const msg = Buffer.concat(errChunks).toString("utf-8").trim();
        reject(new Error(msg || `Le script Python a échoué (code ${code}).`));
      }
    });
  });
}

/** Generate the official PDF for a fiche (ReportLab/Python). */
export async function generateFichePdf(ficheId: string): Promise<Buffer> {
  const { stdout } = await runPython(["--fiche", ficheId, "--stdout"]);
  return stdout;
}

/**
 * Rasterize the fiche's PDF pages to PNG data URLs (one per page) so the
 * browser can show them inline without any PDF-plugin / download dependency.
 */
export async function generateFichePageImages(ficheId: string): Promise<string[]> {
  const { stdout } = await runPython(["--fiche", ficheId, "--png-stdout"]);
  const text = stdout.toString("utf-8").trim();
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Réponse inattendue");
    return parsed as string[];
  } catch {
    throw new Error("Impossible de générer les pages : sortie Python invalide.");
  }
}
