"""Vercel Python Function — rendu officiel du PDF SILOE.

Shape documentée par Vercel (Python Functions in /api):
chaque .py du dossier api/ devient une Function ; le handler doit être un
`BaseHTTPRequestHandler` sous-classé.  Aucun framework ASGI/WSGI requis.

Frontière de sécurité : aucune base de données, aucun secret Supabase.
Le handler valide une enveloppe JSON signée (HMAC-SHA256, PDF_RENDERER_SECRET),
rend le PDF via python.official_pdf.renderer, et ne renvoie jamais de détail
interne.  La logique de vérification est pure (`handle_render_request`) et
testée unitairement sans HTTP.
"""

from __future__ import annotations

import os
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

from python.official_pdf.contracts import (
    ExpiredRendererRequest,
    InvalidRendererPayload,
    InvalidRendererSignature,
    parse_signed_envelope,
)
from python.official_pdf.renderer import render_pdf

METHOD_NOT_ALLOWED = 405
UNAUTHORIZED = 401
BAD_REQUEST = 400
INTERNAL_ERROR = 500


def _json_error(text: str) -> bytes:
    import json
    return json.dumps({"error": text}, ensure_ascii=False).encode("utf-8")


def handle_render_request(body: bytes, signature: str, secret: str, now: int | None = None):
    """Logique pure du handler : (status, content_type, payload_bytes).

    Signature de l'enveloppe : HMAC-SHA256 hexadécimal de `body`, identique au
    calcul TypeScript `createRendererEnvelope`.  Ne lève jamais d'exception
    vers l'appelant HTTP : chaque branche produit un statut HTTP propre.
    `now` est injectable pour les tests ; en production il vaut l'horloge.
    """
    now = now if now is not None else int(time.time())
    if not secret:
        return INTERNAL_ERROR, "application/json", _json_error("Configuration PDF indisponible.")
    if not signature:
        return UNAUTHORIZED, "application/json", _json_error("Non autorisé.")

    try:
        payload = parse_signed_envelope(body, signature, secret, now)
        pdf = render_pdf(payload)
    except (InvalidRendererSignature, ExpiredRendererRequest):
        return UNAUTHORIZED, "application/json", _json_error("Non autorisé.")
    except InvalidRendererPayload:
        return BAD_REQUEST, "application/json", _json_error("Document invalide.")
    except Exception:
        return INTERNAL_ERROR, "application/json", _json_error("Impossible de générer le PDF.")

    return 200, "application/pdf", pdf


class handler(BaseHTTPRequestHandler):
    """Entry point Vercel : sous-classe de BaseHTTPRequestHandler."""

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 0:
            return self.rfile.read(length)
        return b""

    def _respond(self, status: int, content_type: str, payload: bytes):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if payload:
            self.wfile.write(payload)

    def do_POST(self):
        secret = os.environ.get("PDF_RENDERER_SECRET") or ""
        signature = self.headers.get("x-prevision-pdf-signature") or ""
        body = self._read_body()
        status, content_type, payload = handle_render_request(body, signature, secret)
        self._respond(status, content_type, payload)

    def do_GET(self):
        # Réponse minimale pour les sondes/curl sans chemin de rendu.
        self._respond(405, "application/json", _json_error("Méthode non autorisée."))

    def log_message(self, fmt, *args):  # pas de logs d'accès verbeux inutiles
        pass