#!/usr/bin/env python3
"""
rendu_pdf.py — Génère le PDF officiel A4 paysage d'une fiche de prévision
(Primaire ou Secondaire) directement depuis Supabase.

La mise en page (ReportLab) vit désormais dans python/official_pdf/renderer.py ;
ce script ne fait que charger les données (Supabase REST), les mapper vers le
payload imprimable (contrat src/lib/pdf-renderer-contract.ts) et appeler le
renderer pur.

Usage :
  python scripts/rendu_pdf.py --liste
  python scripts/rendu_pdf.py --fiche <uuid> --out chemin.pdf [--apercu]
  python scripts/rendu_pdf.py --payload-stdin --out chemin.pdf   (bridge Node)

Dépendances : reportlab, httpx   (pip install reportlab httpx)
Aperçu PNG  : pip install pdf2image poppler (optionnel)
Variables   : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
              (lues depuis .env.local ou l'environnement)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import httpx
except Exception as e:  # pragma: no cover
    sys.exit(f"ERREUR: httpx manquant — pip install httpx ({e})")

# Permet l'import du package renderer (python/official_pdf) quel que soit le cwd.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from python.official_pdf.renderer import build_pdf, render_pdf
except Exception as e:  # pragma: no cover
    sys.exit(f"ERREUR: reportlab manquant — pip install reportlab ({e})")


# ---------------------------------------------------------------------------
# Environnement
def load_env(path: str = ".env.local") -> dict:
    env = {}
    p = Path(path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_env() -> dict:
    return {**load_env(".env.local"), **os.environ}


# ---------------------------------------------------------------------------
# Supabase (REST via httpx) — chargement des données uniquement
class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(self, table: str, params: dict | None = None) -> list:
        params = params or {}
        r = httpx.get(f"{self.url}/rest/v1/{table}", headers=self.headers, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def list_fiches(self):
        return self.get(
            "attributions",
            {
                "select": "id,classe:classes(name,section),branche:branches(name),"
                          "sous_branche:sous_branches(name),enseignant:profiles(full_name),"
                          "school_year:school_years(label),fiche:fiches(id,statut)",
            },
        )

    def load_fiche(self, fiche_id: str) -> dict:
        """Charge une fiche et la mappe vers le payload imprimable (camelCase)."""
        fiches = self.get("fiches", {"select": "id,statut,attribution_id", "id": f"eq.{fiche_id}"})
        if not fiches:
            raise SystemExit(f"Fiche introuvable : {fiche_id}")
        fiche = fiches[0]
        attr_id = fiche["attribution_id"]

        attr = self.get(
            "attributions",
            {
                "select": "id,classe:classes(name,section),branche:branches(name),"
                          "sous_branche:sous_branches(name),enseignant:profiles(full_name),"
                          "school_year:school_years(label)",
                "id": f"eq.{attr_id}",
            },
        )
        meta_raw = attr[0] if attr else {}

        rows = self.get("fiche_rows", {"select": "*", "fiche_id": f"eq.{fiche_id}", "order": "ordre.asc"})

        cells = {}
        if rows:
            row_ids = ",".join(str(r["id"]) for r in rows)
            for c in self.get("fiche_cells", {"select": "fiche_row_id,col_key,value",
                                               "fiche_row_id": f"in.({row_ids})"}):
                cells.setdefault(str(c["fiche_row_id"]), {})[c["col_key"]] = c["value"]

        meta = {
            "section": (meta_raw.get("classe") or {}).get("section", "primaire"),
            "classe": (meta_raw.get("classe") or {}).get("name", "—"),
            "cours": (meta_raw.get("branche") or {}).get("name", "—"),
            "sousBranche": (meta_raw.get("sous_branche") or {}).get("name"),
            "enseignant": (meta_raw.get("enseignant") or {}).get("full_name", "—"),
            "annee": (meta_raw.get("school_year") or {}).get("label", ""),
        }

        fic_rows = []
        for r in rows:
            fid = str(r["id"])
            fic_rows.append({
                "ordre": r["ordre"],
                "rowType": r["row_type"],
                "mois": r.get("mois"),
                "semaineNum": r.get("semaine_num"),
                "dateLabel": r.get("date_label"),
                "periodeLabel": r.get("periode_label"),
                "evenementLabel": r.get("evenement_label"),
                "cells": cells.get(fid, {}),
            })
        return {"fiche": {"id": fiche["id"], "statut": fiche["statut"]}, "meta": meta, "rows": fic_rows}


# ---------------------------------------------------------------------------
def list_fiches_cli(sb: Supabase):
    rows = []
    for a in sb.list_fiches():
        fiche = a.get("fiche") or {}
        if not fiche:
            continue
        rows.append((fiche["id"], (a.get("classe") or {}).get("name", "?"),
                     (a.get("classe") or {}).get("section", "?"),
                     (a.get("branche") or {}).get("name", "?"),
                     ((a.get("enseignant") or {}).get("full_name") or "?"),
                     fiche.get("statut", "?")))
    if not rows:
        print("Aucune fiche trouvée. Lancer d'abord: node scripts/seed-demo.mjs")
        return
    for fid, cls, sec, br, ens, stt in rows:
        print(f"{fid}  {cls:<6} {sec:<10} {br:<15} {ens:<22} [{stt}]")


def render_pdf_to_png_dataurls(pdf_path: str, dpi: int = 110) -> list[str]:
    """Rasterise chaque page d'un PDF en PNG (data URL) via pypdfium2."""
    import base64
    try:
        import pypdfium2 as pdfium
    except Exception as e:  # pragma: no cover
        sys.exit(f"ERREUR: pypdfium2 manquant — pip install pypdfium2 ({e})")

    pdf = pdfium.PdfDocument(pdf_path)
    out = []
    for page in pdf:
        bitmap = page.render(scale=dpi / 72.0)
        pil = bitmap.to_pil()
        import io
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
    pdf.close()
    return out


def main():
    ap = argparse.ArgumentParser(description="Génère le PDF officiel d'une fiche de prévision.")
    ap.add_argument("--fiche", help="UUID de la fiche (fiches.id).")
    ap.add_argument("--liste", action="store_true", help="Liste les fiches disponibles.")
    ap.add_argument("--payload-stdin", action="store_true",
                    help="Lit le payload JSON imprimable sur stdin (bridge Node), sans Supabase.")
    ap.add_argument("--out", default="prevision.pdf", help="Chemin de sortie PDF.")
    ap.add_argument("--stdout", action="store_true",
                    help="Écrit le PDF brut sur la sortie standard (pour l'intégration serveur).")
    ap.add_argument("--png-stdout", action="store_true",
                    help="Écrit un JSON [dataURL PNG…] des pages sur la sortie standard.")
    ap.add_argument("--apercu", action="store_true", help="Génère aussi un PNG de la 1re page (pdf2image).")
    args = ap.parse_args()

    # Mode bridge (Node → Python) : pas de connexion Supabase nécessaire.
    if args.payload_stdin:
        try:
            payload = json.load(sys.stdin)
        except Exception as e:
            sys.exit(f"ERREUR: payload JSON invalide sur stdin ({e})")
        pdf = render_pdf(payload)
        if args.stdout:
            sys.stdout.buffer.write(pdf)
            return
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_bytes(pdf)
        print("PDF écrit:", args.out)
        return

    env = get_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERREUR: variables NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes (.env.local).")

    sb = Supabase(url, key)

    if args.liste:
        list_fiches_cli(sb)
        return

    if not args.fiche:
        ap.error("Préciser --fiche <uuid> (ou --liste).")

    data = sb.load_fiche(args.fiche)

    if args.stdout or args.png_stdout:
        # Écrit dans un fichier temporaire puis renvoie les octets / PNG sur stdout.
        import tempfile
        fd, tmp = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            build_pdf(data, tmp)
            if args.png_stdout:
                pages = render_pdf_to_png_dataurls(tmp)
                sys.stdout.write(json.dumps(pages))
            else:
                with open(tmp, "rb") as fh:
                    sys.stdout.buffer.write(fh.read())
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
        return

    build_pdf(data, args.out)
    print("PDF écrit:", args.out)

    if args.apercu:
        try:
            from pdf2image import convert_from_path
        except Exception:
            print("(aperçu PNG ignoré — installez pdf2image + poppler)", file=sys.stderr)
        else:
            imgs = convert_from_path(args.out, dpi=110, fmt="png")
            png = str(Path(args.out).with_suffix(".png"))
            imgs[0].save(png)
            print("aperçu:", png)


if __name__ == "__main__":
    main()