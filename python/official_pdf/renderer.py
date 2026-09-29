"""Renderer pur du PDF officiel SILOE (A4 paysage) — ReportLab.

Ce module reçoit UNIQUEMENT un payload imprimable (fiche, meta, rows + cells
sous forme de chaînes).  Il ne connaît ni Supabase, ni session, ni identifiants.
La structure attendue suit le contrat TypeScript `src/lib/pdf-renderer-contract.ts` :

    {
      "fiche": {"id": str, "statut": "brouillon" | "soumise"},
      "meta": {"section", "classe", "cours", "sousBranche", "enseignant", "annee"},
      "rows": [{ "ordre", "rowType", "mois", "semaineNum", "dateLabel",
                 "eventLabel", "eventKind", "moisRowspan", "cells": {col: str} }]

    NB : la mise en page (placement des événements, fusions de mois) est
    calculée côté TypeScript et reçue telle quelle — ce module ne décide plus
    de l'agencement des lignes.
    }

Le rendu (géométrie A4 paysage, polices Source Sans, tableau platypus, fusions
de mois, filigrane BROUILLON, signature) est une extraction sans changement
de la logique historique de scripts/rendu_pdf.py.
"""

from __future__ import annotations

import re
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo

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
        PageBreak,
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
# Polices — Source Sans (TTF chargés localement depuis src/app/fonts)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont

_FONT_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "app" / "fonts"
pdfmetrics.registerFont(TTFont("SourceSans", str(_FONT_DIR / "SourceSans3-Regular.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Italic", str(_FONT_DIR / "SourceSans3-Italic.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Semibold", str(_FONT_DIR / "SourceSans3-Semibold.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Bold", str(_FONT_DIR / "SourceSans3-Bold.ttf")))
pdfmetrics.registerFont(TTFont("SourceSans-Black", str(_FONT_DIR / "SourceSans3-Black.ttf")))
# Famille simulée pour <b>/<i> dans les Paragraphs ReportLab
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
# Date officielle (fuseau de Lubumbashi)
def lubumbashi_date() -> str:
    return datetime.now(ZoneInfo("Africa/Lubumbashi")).strftime("%d/%m/%Y")


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


# ---------------------------------------------------------------------------
# Découpage des pages (reprend la logique actuelle splitPrintPages)
def split_pages(rows: list[dict], section: str) -> list[list[dict]]:
    if section == "primaire":
        idx = next((i for i, r in enumerate(rows)
                    if r["rowType"] == "enseignement" and r.get("mois") in MONTHS_FR[MONTHS_FR.index("Février"):]),
                   len(rows))
        return [rows[:idx], rows[idx:]] if 0 < idx < len(rows) else [rows]
    # secondaire: couper après la première bande vacances/Noël
    idx = next((i for i, r in enumerate(rows)
                if r["rowType"] == "evenement" and re.search(r"noël|fin d'année|vacances", (r.get("eventLabel") or ""), re.I)),
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
        field_para("SOUS-BRANCHE", meta["sousBranche"] or "—")
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

    t = Table([r1, r2], colWidths=widths)
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


# ---------------------------------------------------------------------------
# Rendu d'une grille en Table platypus
def make_table(page_rows, section: str, col_widths_mm, header_names, cell_render,
               fill_height: float | None = None, first_page: bool = True):
    """Construit une Table platypus avec fusion de mois (primaire).

    fill_height : si fourni (points), les lignes du corps sont étirées pour
    que la table remplisse exactement cette hauteur (formulaire papier plein).
    """
    # Lignes d'affichage : listes de cellules (Paragraph)
    data = [header_names]

    # Pour primaire : déterminer les fusions de mois (SPAN vertical)
    spans = []
    if section == "primaire":
        # indices (dans data, après header) des débuts de mois et longueur
        i = 0
        while i < len(page_rows):
            r = page_rows[i]
            m = r.get("mois")
            if m:
                j = i
                while j < len(page_rows) and page_rows[j].get("mois") == m:
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
        head_only = Table([header_names], colWidths=[w * mm for w in col_widths_mm])
        ww, header_h = head_only.wrap(sum(w * mm for w in col_widths_mm), 10_000)
        avail_body = max(fill_height - header_h, n_body * 5 * mm)
        min_body = avail_body / n_body
        # L'en-tête garde sa hauteur ; chaque ligne du corps >= min_body
        # (les cellules contenant du texte pourront dépasser).
        row_heights = [header_h] + [min_body] * n_body

    t = Table(data, colWidths=[w * mm for w in col_widths_mm],
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
    # Semaine d'événement (primaire) : fond clair + fusion des colonnes matière.
    # La ligne reste une ligne de semaine : on ne fusionne PAS le mois/semaine.
    EVENT_BG = colors.HexColor("#ededed")
    for i, r in enumerate(page_rows, start=1):
        if r["rowType"] != "evenement":
            continue
        style.append(("BACKGROUND", (0, i), (-1, i), EVENT_BG))
        if section == "primaire":
            style.append(("SPAN", (2, i), (5, i)))
        else:
            # secondaire : bande pleine largeur (disposition approuvée)
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
    """Une ligne primaire.

    Semaine d'événement : la ligne reste une ligne de semaine (mois + semaine) et
    le nom de l'événement occupe les colonnes matière, fusionnées (SPAN) — c'est
    la disposition du document officiel, pas une bande pleine largeur.
    """
    mois = r.get("mois") or ""
    week = f"{r.get('semaineNum') or ''} · {compact_week(r.get('dateLabel') or '')}" if (r.get('semaineNum') is not None or r.get('dateLabel')) else ""
    if r.get("rowType") == "evenement":
        label = (r.get("eventLabel") or r.get("eventKind") or "").upper()
        return [
            p(mois, cell_style_bc),                    # mois (fusionné)
            p(week, cell_style_bc),
            Paragraph(f"<b>{label}</b>", cell_style_bc),  # SPAN sur les 4 colonnes
        ]
    return [
        p(mois, cell_style_bc),                    # mois (sera fusionné)
        p(week, cell_style_bc),
        p(r["cells"].get("matieres", ""), cell_style),
        p(r["cells"].get("ref", ""), cell_style),
        p(r["cells"].get("intention", ""), cell_style),
        p(r["cells"].get("obs", ""), cell_style),
    ]


def render_secondary_row(r: dict):
    if r["rowType"] == "evenement":
        # Le secondaire garde sa disposition en bandes (design approuvé).
        label = (r.get("eventLabel") or r.get("eventKind") or "").upper()
        return [Paragraph(f"<b>{label}</b>", cell_style_bc)]
    return [
        p(str(r.get("semaineNum") or ""), cell_style_c),
        p(compact_week(r.get("dateLabel") or ""), cell_style_bc),
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
    today = lubumbashi_date()
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
def _build_pdf(data: dict, out_stream):
    """Rendu pur : construit le PDF dans un file-like binaire (ou un chemin)."""
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
        out_stream,
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
            story.append(PageBreak())

    doc.build(story, canvasmaker=NumberedCanvas)


def render_pdf(payload: dict) -> bytes:
    """Rend le payload imprimable et renvoie les octets PDF."""
    output = BytesIO()
    _build_pdf(payload, output)
    return output.getvalue()


def build_pdf(data: dict, out_path):
    """Compat CLI locale : écrit directement dans un fichier (comportement historique)."""
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _build_pdf(data, str(path))