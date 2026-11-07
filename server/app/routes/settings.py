"""Voice & alert preferences chosen on the Setup screen."""
from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..store import DEFAULT_SETTINGS, get_store

bp = Blueprint("settings", __name__)


@bp.get("")
@require_auth
def get_settings():
    return jsonify(get_store().get_settings(g.uid))


@bp.put("")
@require_auth
def update_settings():
    body = request.get_json(force=True) or {}
    allowed = {k: v for k, v in body.items() if k in DEFAULT_SETTINGS}
    return jsonify(get_store().save_settings(g.uid, allowed))
