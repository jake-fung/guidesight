"""Verifies the Firebase ID token the web app sends as `Authorization: Bearer <token>`."""
from functools import wraps

from flask import current_app, g, jsonify, request

from .config import Config

DEV_UID = "dev-user"


def verify_token(token: str) -> str | None:
    if current_app.config.get("TESTING") or not Config.firebase_enabled():
        # Mock mode: accept any token so the app works before Firebase is set up.
        return DEV_UID if token else None

    from firebase_admin import auth

    try:
        return auth.verify_id_token(token)["uid"]
    except Exception:  # invalid, expired, or revoked
        return None


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header.removeprefix("Bearer ").strip()
        uid = verify_token(token)
        if not uid:
            return jsonify(error="unauthorized"), 401
        g.uid = uid
        return fn(*args, **kwargs)

    return wrapper
