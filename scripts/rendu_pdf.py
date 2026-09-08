#!/usr/bin/env python3
"""
rendu_pdf.py — Génère le PDF officiel A4 paysage d'une fiche de prévision
(Primaire ou Secondaire) directement depuis Supabase, avec ReportLab.

Le rendu remplace l'ancienne sortie HTML→Chrome : le tableau est composé avec
platypus (colonnes fixes, cellules fusionnées pour les mois, hauteurs de ligne
calculées d'après le contenu, césure propre), ce qui corrige les lignes
écrasées et le rendu médiocre du tableau dans le navigateur.

Usage :
  python scripts/rendu_pdf.py --liste
  python scripts/rendu_pdf.py --fiche <uuid> --out chemin.pdf [--apercu]

Dépendances : reportlab, httpx   (pip install reportlab httpx)
Aperçu PNG  : pip install pdf2image poppler (optionnel)
Variables   : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
              (lues depuis .env.local ou l'environnement)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date
from pathlib import Path

try:
    import httpx
except Exception as e:  # pragma: no cover
    sys.exit(f"ERREUR: httpx manquant — pip install httpx ({e})")

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas as _canvas_mod
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        PageTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
    )
except Exception as e:  # pragma: no cover
    sys.exit(f"ERREUR: reportlab manquant — pip install reportlab ({e})")

# ---------------------------------------------------------------------------
# Constantes
SCHOOL_NAME = "COMPLEXE SCOLAIRE SILOE"
SCHOOL_ADDR_1 = "2938/40, AV. LES ÉLITES"
SCHOOL_ADDR_2 = "Q/GAMBELA — C/LUBUMBASHI"
PAGE_W, PAGE_H = landscape(A4)  # 841.89 x 595.28

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
# Supabase (REST via httpx)
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
            "sous_branche": (meta_raw.get("sous_branche") or {}).get("name"),
            "enseignant": (meta_raw.get("enseignant") or {}).get("full_name", "—"),
            "annee": (meta_raw.get("school_year") or {}).get("label", ""),
        }

        fic_rows = []
        for r in rows:
            fid = str(r["id"])
            fic_rows.append({
                "id": fid,
                "row_type": r["row_type"],
                "mois": r.get("mois"),
                "semaine_num": r.get("semaine_num"),
                "date_label": r.get("date_label"),
                "periode_label": r.get("periode_label"),
                "evenement_label": r.get("evenement_label"),
                "cells": cells.get(fid, {}),
            })
        return {"fiche": fiche, "meta": meta, "rows": fic_rows}


# ---------------------------------------------------------------------------
# Helpers texte
MONTHS_FR = ["Septembre", "Octobre", "Novembre", "Décembre", "Janvier", "Février",
             "Mars", "Avril", "Mai", "Juin", "Juillet", "Août"]


def compact_week(label: str) -> str:
    """'01/09/2026 → 04/09/2026' ou '01 → 04/09/2026' → '01 au 04/09/2026'
    (année complète sur 4 chiffres)."""
    if not label:
        return ""
    m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})\s*→\s*(\d{2})/(\d{2})/(\d{2,4})", label)
    if m:
        d1, _, _, d2, mo2, y2 = m.groups()
        return f"{d1} au {d2}/{mo2}/{_full_year(y2)}"
    m = re.search(r"(\d{2})\s*→\s*(\d{2})/(\d{2})/(\d{2,4})", label)
    if m:
        d1, d2, mo2, y2 = m.groups()
        return f"{d1} au {d2}/{mo2}/{_full_year(y2)}"
    return label


def _full_year(y: str) -> str:
    """'26' → '2026' ; '2026' → '2026'."""
    y = y.strip()
    return ("20" + y) if len(y) == 2 else y


def _y2(y: str) -> str:
    return y[-2:] if len(y) == 4 else y


# ---------------------------------------------------------------------------
# Polices — Source Sans (fichiers TTF chargés localement depuis src/app/fonts)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

_FONT_DIR = Path(__file__).resolve().parent.parent / "src" / "app" / "fonts"
pdfmetrics.registerFont(TTFont("SourceSans", str(_FONT_DIR / "SourceSans3-Regular.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Italic", str(_FONT_DIR / "SourceSans3-Italic.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Semibold", str(_FONT_DIR / "SourceSans3-Semibold.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Bold", str(_FONT_DIR / "SourceSans3-Bold.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Black", str(_FONT_DIR / "SourceSans3-Black.ttf")))
# Famille simulée pour <b>/<i> dans les Paragraphs ReportLab
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily(
    "SourceSans",
    normal="SourceSans",
    bold="SourceSans-Bold",
    italic="SourceSans-Italic",
    boldItalic="SourceSans-Bold",
)

FONT = "SourceSans"
FONT_B = "SourceSans-Bold"
FONT_SEMI = "SourceSans-Semibold"
FONT_BLACK = "SourceSans-Black"

def st(**kw):
    base = dict(fontName=FONT, fontSize=8, leading=9.5, textColor=colors.black)
    base.update(kw)
    return ParagraphStyle("x", **base)


cell_style = st()
cell_style_c = st(alignment=TA_CENTER)
cell_style_b = st(fontName=FONT_B)
cell_style_bc = st(fontName=FONT_B, alignment=TA_CENTER)
cell_style_small = st(fontSize=7.5, leading=9)


# ---------------------------------------------------------------------------
# Découpage des pages (reprend la logique actuelle splitPrintPages)
def split_pages(rows: list[dict], section: str) -> list[list[dict]]:
    if section == "primaire":
        idx = next((i for i, r in enumerate(rows)
                    if r["row_type"] == "enseignement" and r.get("mois") in MONTHS_FR[MONTHS_FR.index("Février"):]),
                   len(rows))
        return [rows[:idx], rows[idx:]] if 0 < idx < len(rows) else [rows]
    # secondaire: couper après la première bande vacances/Noël
    idx = next((i for i, r in enumerate(rows)
                if r["row_type"] == "evenement" and re.search(r"noël|fin d'année|vacances", (r.get("periode_label") or ""), re.I)),
               len(rows))
    if 0 < idx + 1 < len(rows):
        return [rows[: idx + 1], rows[idx + 1:]]
    return [rows]


def measure_flowable_height(flow, avail_w: float) -> float:
    """Hauteur totale d'une liste de flowables (pour dimensionner la table)."""
    total = 0.0
    for fl in flow:
        w, h = fl.wrap(avail_w, 10_000)
        total += h
    return total


# ---------------------------------------------------------------------------
# Document (en-tête de page + pied de page)
def header_flowable(meta: dict, title: str, section_label: str, include_full: bool = True):
    """En-tête du document.

    include_full=True  -> page 1 : nom école + adresse + année + titre + champs.
    include_full=False -> pages suivantes : pas de rappel d'en-tête (juste une
                          petite ligne « Suite » ou rien).
    """
    from reportlab.platypus import Table as T

    if not include_full:
        return []

    label_st = st(fontName=FONT_B, fontSize=9, leading=10.5)

    def field_para(label, value):
        """Label + valeur dans un même paragraphe : la valeur épouse le label
        (ex. « SECTION : PRIMAIRE »), pas de grand espace vide entre les deux."""
        v = (value or "—").upper()
        return Paragraph(f"<b>{label} :</b>&nbsp;&nbsp;{v}", label_st)

    # Trois paires par rangée ; chaque paire = une cellule compacte.
    r1 = [
        field_para("SECTION", section_label),
        field_para("CLASSE", meta["classe"]),
        field_para("TITULAIRE" if meta["section"] == "primaire" else "PROFESSEUR", meta["enseignant"]),
    ]
    r2 = [
        field_para("BRANCHE", meta["cours"]),
        # La sous-branche n'existe qu'en primaire (les matières du secondaire
        # n'en ont pas) — on laisse la cellule vide en secondaire.
        field_para("SOUS-BRANCHE", meta["sous_branche"] or "—")
        if meta["section"] == "primaire"
        else Paragraph("", label_st),
        Paragraph("", label_st),
    ]

    # Les paires sont réparties sur toute la largeur, avec un espace régulier
    # entre elles (la valeur reste collée à son label dans chaque cellule).
    usable_w = PAGE_W - 16 * mm
    pair_w = usable_w / 3.0
    widths = [pair_w] * 3

    style = [
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]

    t = T([r1, r2], colWidths=widths)
    t.setStyle(TableStyle(style))

    flow = [
        Paragraph(SCHOOL_NAME, st(fontName=FONT_B, fontSize=14, leading=16, alignment=TA_CENTER)),
        Paragraph(f"{SCHOOL_ADDR_1} — {SCHOOL_ADDR_2}", st(fontSize=9, alignment=TA_CENTER)),
        Paragraph(f"ANNÉE SCOLAIRE {meta['annee']}".strip(), st(fontName=FONT_B, fontSize=10, alignment=TA_CENTER)),
        Spacer(1, 3),
        Paragraph(f"<u>{title}</u>", st(fontName=FONT_B, fontSize=15, leading=18, alignment=TA_CENTER)),
        Spacer(1, 5),
        t,
        Spacer(1, 2),
    ]
    return flow


class NumberedCanvas(_canvas_mod.Canvas):
    """Canvas qui écrit le numéro de page / total après la 2e passe."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.setFont(FONT, 8)
            self.setFillColor(colors.grey)
            self.drawCentredString(PAGE_W / 2, 5 * mm, f"— Page {self._pageNumber} / {total} —")
            super().showPage()
        super().save()


def footer(canv, doc):
    pass  # replaced by NumberedCanvas


# ---------------------------------------------------------------------------
# Rendu d'une grille en Table platypus
def make_table(page_rows, section: str, col_widths_mm, header_names, cell_render,
               fill_height: float | None = None, first_page: bool = True):
    """Construit une Table platypus avec fusion de mois (primaire).

    fill_height : si fourni (points), les lignes du corps sont étirées pour
    que la table remplisse exactement cette hauteur (formulaire papier plein).
    """
    from reportlab.platypus import Table as T

    # Lignes d'affichage : listes de cellules (Paragraph)
    data = [header_names]

    # Pour primaire : déterminer les fusions de mois (SPAN vertical)
    spans = []
    if section == "primaire":
        # indices (dans data, après header) des débuts de mois et longueur
        teach_rows = [i for i, r in enumerate(page_rows) if r["row_type"] == "enseignement"]
        i = 0
        while i < len(page_rows):
            r = page_rows[i]
            if r["row_type"] == "enseignement":
                m = r.get("mois")
                j = i
                while j < len(page_rows) and page_rows[j]["row_type"] == "enseignement" and page_rows[j].get("mois") == m:
                    j += 1
                if j - i > 1:
                    # data row offset: header=0, page row i -> data row i+1
                    spans.append((1 + i, j - i))
                i = j
            else:
                i += 1

    for r in page_rows:
        data.append(cell_render(r))

    # Lignes du corps : hauteurs minimales pour remplir la page si demandé.
    n_body = len(page_rows)
    row_heights = None
    if fill_height and n_body > 0:
        # Estimer la hauteur réelle de la ligne d'en-tête.
        from reportlab.platypus import Table as _T
        head_only = _T([header_names], colWidths=[w * mm for w in col_widths_mm])
        # force wrap measure
        ww, header_h = head_only.wrap(sum(w * mm for w in col_widths_mm), 10_000)
        avail_body = max(fill_height - header_h, n_body * 5 * mm)
        min_body = avail_body / n_body
        # L'en-tête garde sa hauteur ; chaque ligne du corps >= min_body
        # (les cellules contenant du texte pourront dépasser).
        row_heights = [header_h] + [min_body] * n_body

    t = T(data, colWidths=[w * mm for w in col_widths_mm],
          rowHeights=row_heights, repeatRows=1)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f1f1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("VALIGN", (2, 1), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    # bandes événements : fond clair
    for i, r in enumerate(page_rows, start=1):
        if r["row_type"] == "evenement":
            style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fbfbf7")))
            style.append(("SPAN", (0, i), (-1, i)))

    # fusion mois primaire
    for start_data, n in spans:
        style.append(("SPAN", (0, start_data), (0, start_data + n - 1)))
        style.append(("BACKGROUND", (0, start_data), (0, start_data + n - 1), colors.HexColor("#f7f7f7")))

    t.setStyle(TableStyle(style))
    return t


# --- Renderers de cellules ---
def p(text, style=cell_style):
    return Paragraph((text or "").replace("&", "&amp;").replace("<", "&lt;"), style)


def render_primary_row(r: dict):
    if r["row_type"] == "evenement":
        label = (r.get("periode_label") or r.get("evenement_label") or "").upper()
        return [Paragraph(f"<b>{label}</b>", cell_style_bc)]
    mois = r.get("mois") or ""
    week = f"{r.get('semaine_num') or ''} · {compact_week(r.get('date_label') or '')}" if (r.get('semaine_num') is not None or r.get('date_label')) else ""
    return [
        p(mois, cell_style_bc),                    # mois (sera fusionné)
        p(week, cell_style_bc),
        p(r["cells"].get("matieres", ""), cell_style),
        p(r["cells"].get("ref", ""), cell_style),
        p(r["cells"].get("intention", ""), cell_style),
        p(r["cells"].get("obs", ""), cell_style),
    ]


def render_secondary_row(r: dict):
    if r["row_type"] == "evenement":
        label = (r.get("periode_label") or "").upper()
        return [Paragraph(f"<b>{label}</b>", cell_style_bc)]
    return [
        p(str(r.get("semaine_num") or ""), cell_style_c),
        p(compact_week(r.get("date_label") or ""), cell_style_bc),
        p(r["cells"].get("heure", ""), cell_style_c),
        p(r["cells"].get("matieres", ""), cell_style),
        p(r["cells"].get("mv", ""), cell_style),
        p(r["cells"].get("obs", ""), cell_style),
    ]


# ---------------------------------------------------------------------------
# Signature
def signature_flow(meta: dict, draft_date: bool = True):
    """Bloc de signature en bas de la dernière page.

    La date (« Fait à Lubumbashi, le … ») et « LA DIRECTION » sont empilées
    verticalement (date au-dessus) et centrées horizontalement dans la zone
    située sous les colonnes INTENTION → OBS du tableau (et non alignées à
    l'extrémité droite de la page).
    """
    today = date.today().strftime("%d/%m/%Y")
    # Zone cible : sous INTENTION + OBS (pour la grille primaire, INTENTION
    # commence à 208 mm du bord gauche et OBS se termine à 289 mm).
    zone_start = 208 * mm
    zone_width = 81 * mm
    return [
        Spacer(1, 10),
        Table(
            [[
                Paragraph("", st(fontSize=9)),  # espace avant la zone cible
                Paragraph(
                    f"Fait à Lubumbashi, le {today}<br/><br/><b>LA DIRECTION</b>",
                    st(fontName=FONT_B, fontSize=9.5, alignment=1, leading=13),
                ),
            ]],
            colWidths=[zone_start - 8 * mm, zone_width],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]),
        ),
    ]


# ---------------------------------------------------------------------------
# Assemblage du document
def build_pdf(data: dict, out_path: str):
    meta = data["meta"]
    section = meta.get("section", "primaire")
    title = "PRÉVISION ANNUELLE" if section == "primaire" else "PRÉVISION DES MATIÈRES"
    section_label = "Primaire" if section == "primaire" else "Secondaire"
    statut = data["fiche"].get("statut", "brouillon")
    draft = statut == "brouillon"

    pages = split_pages(data["rows"], section)

    # largeurs de colonnes (mm) selon section
    if section == "primaire":
        # RÉF. et INTENTION à largeur égale (comme demandé).
        widths = [20, 34, 86, 60, 60, 21]          # ≈ total 281 mm
        headers = [p("MOIS", cell_style_bc), p("SEMAINE — DATE", cell_style_bc),
                   p("MATIÈRES À ENSEIGNER", cell_style_bc), p("RÉF.", cell_style_bc),
                   p("INTENTION", cell_style_bc), p("OBS.", cell_style_bc)]
    else:
        # SEMAINES un peu plus étroite ; MATIÈRES PREVUES élargie en retour.
        widths = [12, 34, 18, 126, 45, 45]          # ≈ total 280 mm
        headers = [p("N°", cell_style_bc), p("SEMAINES", cell_style_bc), p("HEURE", cell_style_bc),
                   p("MATIÈRES PREVUES", cell_style_bc), p("M.V", cell_style_bc), p("OBS.", cell_style_bc)]

    doc = BaseDocTemplate(
        out_path,
        pagesize=landscape(A4),
        leftMargin=8 * mm, rightMargin=8 * mm,
        topMargin=5 * mm, bottomMargin=9 * mm,
        title=f"{title} — {meta['classe']}",
        author="SILOE",
    )

    # Cadre : le contenu commence plus haut (proche du bord supérieur).
    frame = Frame(8 * mm, 9 * mm, PAGE_W - 16 * mm, PAGE_H - 14 * mm, id="main")

    def on_page(canv, doc_):
        canv.saveState()
        # Filigrane sur chaque page
        if draft:
            canv.setFillColor(colors.HexColor("#c21e1e"))
            canv.setFont(FONT_B, 64)
            canv.saveState()
            canv.translate(PAGE_W / 2, PAGE_H / 2)
            canv.rotate(-24)
            canv.setFillColor(colors.HexColor("#d03030"))
            canv.setFillAlpha(0.10)
            canv.drawCentredString(0, 0, "BROUILLON")
            canv.restoreState()
        canv.restoreState()

    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])

    story = []
    total_pages = len(pages)

    for pi, chunk in enumerate(pages):
        # Bloc placé avant la table selon la page.
        if pi == 0:
            pre = header_flowable(meta, title, section_label, include_full=True)
        else:
            pre = [Paragraph("SUITE", st(fontName=FONT_B, fontSize=9, alignment=2)),
                   Spacer(1, 2)]
        # Mesure réelle du bloc pré-table (pour dimensionner la table).
        pre_h = measure_flowable_height(pre, PAGE_W - 16 * mm)
        # Signature éventuelle sur la dernière page (mesurée, pas devinée).
        sig_h = 0
        if pi == total_pages - 1:
            sig = signature_flow(meta)
            sig_h = measure_flowable_height(sig, PAGE_W - 16 * mm)

        # Hauteur exacte restante pour la table, moins une marge de sécurité
        # pour éviter que ReportLab scinde la dernière ligne sur une page suiv.
        SAFETY = 5 * mm
        avail_table = (PAGE_H - 14 * mm) - pre_h - sig_h - SAFETY

        story += pre

        # Table
        t = make_table(chunk, section, widths, headers,
                       render_primary_row if section == "primaire" else render_secondary_row,
                       fill_height=avail_table, first_page=(pi == 0))
        story.append(t)
        if pi == total_pages - 1:
            story += signature_flow(meta)
        if pi < total_pages - 1:
            from reportlab.platypus import PageBreak
            story.append(PageBreak())

    doc.build(story, canvasmaker=NumberedCanvas)


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
    # aligner
    for fid, cls, sec, br, ens, stt in rows:
        print(f"{fid}  {cls:<6} {sec:<10} {br:<15} {ens:<22} [{stt}]")


def main():
    ap = argparse.ArgumentParser(description="Génère le PDF officiel d'une fiche de prévision.")
    ap.add_argument("--fiche", help="UUID de la fiche (fiches.id).")
    ap.add_argument("--liste", action="store_true", help="Liste les fiches disponibles.")
    ap.add_argument("--out", default="prevision.pdf", help="Chemin de sortie PDF.")
    ap.add_argument("--stdout", action="store_true",
                    help="Écrit le PDF brut sur la sortie standard (pour l'intégration serveur).")
    ap.add_argument("--png-stdout", action="store_true",
                    help="Écrit un JSON [dataURL PNG…] des pages sur la sortie standard.")
    ap.add_argument("--apercu", action="store_true", help="Génère aussi un PNG de la 1re page (pdf2image).")
    args = ap.parse_args()

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
                import json as _json
                sys.stdout.write(_json.dumps(pages))
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
