import unittest

from python.official_pdf.contracts import (
    ExpiredRendererRequest,
    InvalidRendererPayload,
    InvalidRendererSignature,
    parse_signed_envelope,
    verify_hmac,
)


def make_body(issued_at: int = 1_700_000_000, payload=None) -> bytes:
    import json
    env = {
        "issuedAt": issued_at,
        "payload": payload
        if payload is not None
        else {
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
                "eventLabel": None, "eventKind": None, "moisRowspan": 1,
                "cells": {"matieres": "Lecture", "ref": "", "intention": "", "obs": ""},
            }],
        },
    }
    return json.dumps(env, ensure_ascii=False).encode("utf-8")


class HmacTests(unittest.TestCase):
    def test_valid_signature_verifies(self):
        body = make_body()
        self.assertTrue(verify_hmac(body, self._sig(body), "secret"))

    def test_wrong_signature_fails(self):
        body = make_body()
        self.assertFalse(verify_hmac(body, "0" * 64, "secret"))

    @staticmethod
    def _sig(body: bytes, secret: str = "secret") -> str:
        import hashlib
        import hmac
        return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class ParseSignedEnvelopeTests(unittest.TestCase):
    NOW = 1_700_000_001

    def _parse(self, body: bytes, secret: str = "secret", signature: str | None = None):
        import hashlib
        import hmac
        sig = signature
        if sig is None:
            sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return parse_signed_envelope(body, sig, secret, self.NOW)

    def test_valid_envelope_parses(self):
        body = make_body()
        parsed = self._parse(body)
        self.assertEqual(parsed["fiche"]["id"], "f1")

    def test_wrong_signature_rejected(self):
        body = make_body()
        with self.assertRaises(InvalidRendererSignature):
            self._parse(body, signature="0" * 64)

    def test_stale_request_rejected(self):
        body = make_body(issued_at=self.NOW - 120)
        with self.assertRaises(ExpiredRendererRequest):
            self._parse(body)

    def test_malformed_payload_rejected(self):
        body = make_body(payload={"fiche": {}})
        with self.assertRaises(InvalidRendererPayload):
            self._parse(body)

    def test_unknown_top_level_fields_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        env["admin"] = True
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))

    def test_invalid_section_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        env["payload"]["meta"]["section"] = "maternelle"
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))

    def test_non_string_cell_value_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        env["payload"]["rows"][0]["cells"]["matieres"] = 123
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))

    def test_empty_fiche_id_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        env["payload"]["fiche"]["id"] = ""
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))

    def test_excess_rows_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        row = env["payload"]["rows"][0]
        env["payload"]["rows"] = [dict(row) for _ in range(401)]
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))

    def test_oversized_cell_rejected(self):
        import json
        body = make_body()
        env = json.loads(body.decode("utf-8"))
        env["payload"]["rows"][0]["cells"]["matieres"] = "x" * 20_001
        with self.assertRaises(InvalidRendererPayload):
            self._parse(json.dumps(env).encode("utf-8"))


if __name__ == "__main__":
    unittest.main()