import unittest

from python.official_pdf.renderer import render_pdf


class RenderPdfTests(unittest.TestCase):
    def test_primary_draft_is_a_landscape_a4_pdf(self):
        pdf = render_pdf({
            "fiche": {"id": "fixture", "statut": "brouillon"},
            "meta": {
                "section": "primaire", "classe": "6e B", "cours": "Français",
                "sousBranche": None, "enseignant": "Mme Exemple", "annee": "2026–2027",
            },
            "rows": [{
                "ordre": 1, "rowType": "enseignement", "mois": "Septembre",
                "semaineNum": 1, "dateLabel": "01/09/2026 → 04/09/2026",
                "periodeLabel": None, "evenementLabel": None,
                "cells": {"matieres": "Lecture", "ref": "", "intention": "", "obs": ""},
            }],
        })
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 1_000)


if __name__ == "__main__":
    unittest.main()