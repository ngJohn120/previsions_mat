import hashlib
import hmac
import json
import unittest

from api.render_pdf import handle_render_request

VALID_PAYLOAD = {
    "fiche": {"id": "f1", "statut": "brouillon"},
    "meta": {
        "section": "primaire",
        "classe": "6e B",
        "cours": "Français",
        "sousBranche": None,
        "enseignant": "Mme Exemple",
        "annee": "2026–2027",
    },
    "rows": [{
        "ordre": 1, "rowType": "enseignement", "mois": "Septembre",
        "semaineNum": 1, "dateLabel": "01/09/2026 → 04/09/2026",
        "periodeLabel": None, "evenementLabel": None,
        "cells": {"matieres": "Lecture", "ref": "", "intention": "", "obs": ""},
    }],
}


def signed_body(secret: str = "render-secret", issued_at: int = 1_700_000_000,
                payload: dict | None = None) -> bytes:
    body = json.dumps({"issuedAt": issued_at, "payload": payload or VALID_PAYLOAD},
                      ensure_ascii=False).encode("utf-8")
    return body


def signature(body: bytes, secret: str = "render-secret") -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class HandleRenderRequestTests(unittest.TestCase):
    NOW = 1_700_000_001

    def _handle(self, body: bytes, sig: str, secret: str = "render-secret"):
        return handle_render_request(body, sig, secret, self.NOW)

    def test_missing_secret_is_500(self):
        status, ctype, payload = self._handle(b"{}", "sig", "")
        self.assertEqual(status, 500)
        self.assertIn(b"Configuration", payload)

    def test_missing_signature_is_401(self):
        status, ctype, payload = self._handle(signed_body(), "")
        self.assertEqual(status, 401)
        self.assertEqual(ctype, "application/json")

    def test_wrong_signature_is_401(self):
        status, ctype, payload = self._handle(signed_body(), "0" * 64)
        self.assertEqual(status, 401)
        self.assertNotIn(b"stack", payload)

    def test_valid_request_returns_pdf(self):
        body = signed_body()
        status, ctype, pdf = self._handle(body, signature(body))
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "application/pdf")
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 1_000)

    def test_malformed_payload_is_400(self):
        body = signed_body(payload={"fiche": {}})
        status, ctype, payload = self._handle(body, signature(body))
        self.assertEqual(status, 400)

    def test_stale_request_is_401(self):
        body = signed_body(issued_at=self.NOW - 120)
        status, ctype, payload = self._handle(body, signature(body))
        self.assertEqual(status, 401)

    def test_error_response_never_exposes_internals(self):
        body = signed_body(payload={"fiche": {}})
        status, ctype, payload = self._handle(body, signature(body))
        self.assertEqual(status, 400)
        self.assertNotIn(b"Traceback", payload)
        self.assertNotIn(b"contracts", payload)
        self.assertNotIn(b"renderer", payload)


if __name__ == "__main__":
    unittest.main()