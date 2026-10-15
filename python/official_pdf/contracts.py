"""Validation de la frontière de sécurité du rendu PDF (standard library only).

Le Vercel Python Function n'a AUCUN accès base de données : il reçoit un
enveloppe JSON signée (HMAC-SHA256, serveur→serveur) et la valide strictement
avant de rendre le PDF.  Aucun secret Supabase, aucun .env.local, aucune
variable NEXT_PUBLIC_* ici.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

MAX_AGE_SECONDS = 60
MAX_FUTURE_SKEW_SECONDS = 5

MAX_ROWS = 400
MAX_LABEL_CHARS = 1_000
MAX_CELL_CHARS = 20_000

VALID_SECTIONS = ("primaire", "secondaire")
VALID_STATUTS = ("brouillon", "soumise")
VALID_ROW_TYPES = ("enseignement", "evenement")


class InvalidRendererSignature(Exception):
    """Signature HMAC absente, inconnue ou expirée."""


class ExpiredRendererRequest(InvalidRendererSignature):
    """Enveloppe signée mais hors fenêtre de validité (horloge/âge)."""


class InvalidRendererPayload(Exception):
    """Enveloppe signée mais structure ou limites invalides."""


def verify_hmac(body: bytes, signature: str, secret: str) -> bool:
    """Vrai si `signature` est le HMAC-SHA256 hexadécimal exact de `body`."""
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (signature or "").lower())


def _reject(reason: str):
    raise InvalidRendererPayload(reason)


def _validate_payload(payload) -> None:
    if not isinstance(payload, dict):
        _reject("payload doit être un objet")

    fiche = payload.get("fiche")
    if not isinstance(fiche, dict) or not isinstance(fiche.get("id"), str) or not fiche["id"]:
        _reject("payload.fiche.id manquant ou vide")
    if fiche.get("statut") not in VALID_STATUTS:
        _reject("payload.fiche.statut invalide")

    meta = payload.get("meta")
    if not isinstance(meta, dict):
        _reject("payload.meta manquant")
    if meta.get("section") not in VALID_SECTIONS:
        _reject("payload.meta.section invalide")
    for key in ("classe", "cours", "enseignant"):
        if not isinstance(meta.get(key), str):
            _reject(f"payload.meta.{key} doit être une chaîne")
    if meta.get("sousBranche") is not None and not isinstance(meta.get("sousBranche"), str):
        _reject("payload.meta.sousBranche doit être une chaîne ou null")
    if not isinstance(meta.get("annee"), str):
        _reject("payload.meta.annee doit être une chaîne")

    rows = payload.get("rows")
    if not isinstance(rows, list):
        _reject("payload.rows doit être une liste")
    if len(rows) > MAX_ROWS:
        _reject("payload.rows dépasse la limite")

    for row in rows:
        if not isinstance(row, dict):
            _reject("row doit être un objet")
        if row.get("rowType") not in VALID_ROW_TYPES:
            _reject("row.rowType invalide")
        if not isinstance(row.get("ordre"), int):
            _reject("row.ordre doit être un entier")
        for key in ("mois", "dateLabel", "eventLabel", "eventKind"):
            v = row.get(key)
            if v is not None and not isinstance(v, str):
                _reject(f"row.{key} doit être une chaîne ou null")
            if isinstance(v, str) and len(v) > MAX_LABEL_CHARS:
                _reject("label trop long")
        if row.get("semaineNum") is not None and not isinstance(row.get("semaineNum"), int):
            _reject("row.semaineNum doit être un entier ou null")

        cells = row.get("cells")
        if not isinstance(cells, dict):
            _reject("row.cells doit être un objet")
        for col, value in cells.items():
            if not isinstance(value, str):
                _reject("cellule doit être une chaîne")
            if len(value) > MAX_CELL_CHARS:
                _reject("cellule trop longue")


def parse_signed_envelope(
    body: bytes, signature: str, secret: str, now: int | None = None
) -> dict:
    """Valide et renvoie le payload d'une enveloppe signée (HMAC + structure).

    Signature de l'enveloppe : HMAC-SHA256(secret, body) en hexadécimal —
    le même calcul que `createRendererEnvelope` côté TypeScript.

    Ordre : HMAC d'abord (constant-time), puis fenêtre temporelle, puis
    validation stricte de la structure et des limites.
    """
    now = now if now is not None else int(time.time())

    header = {}
    try:
        header = json.loads(body.decode("utf-8"))
    except Exception:
        _reject("JSON invalide")

    if not verify_hmac(body, signature, secret):
        raise InvalidRendererSignature("signature invalide")

    _check_signature_timing(header, now)
    _validate_payload(header.get("payload"))
    return header["payload"]


def _check_signature_timing(header, now: int) -> None:
    if not isinstance(header.get("issuedAt"), int):
        _reject("issuedAt manquant ou invalide")
    issued = header["issuedAt"]
    if set(header.keys()) != {"issuedAt", "payload"}:
        _reject("champs racine inattendus")
    if issued > now + MAX_FUTURE_SKEW_SECONDS:
        raise ExpiredRendererRequest("issuedAt dans le futur")
    if now - issued > MAX_AGE_SECONDS:
        raise ExpiredRendererRequest("enveloppe expirée")