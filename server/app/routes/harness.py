"""Harness status and test buzz for the Setup screen. The live link itself is in app/live.py."""
from flask import Blueprint, abort, g, jsonify, request

from ..auth import require_auth
from ..live import PATTERNS, buzz_user_harness, get_hub
from ..store import get_store

bp = Blueprint("harness", __name__)


@bp.get("/status")
@require_auth
def status():
    harness_id = get_store().get_settings(g.uid).get("harness_id")
    return jsonify(harness_id=harness_id, online=get_hub().is_online(harness_id))


@bp.post("/buzz")
@require_auth
def buzz():
    pattern = (request.get_json(silent=True) or {}).get("pattern", "short")
    if pattern not in PATTERNS:
        abort(400, description="pattern must be 'short', 'double' or 'long'")
    return jsonify(delivered=buzz_user_harness(g.uid, pattern))
