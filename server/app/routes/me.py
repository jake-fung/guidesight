"""The signed-in user: profile (name, email), first-run setup progress and settings in one call.

The app calls GET /api/me after sign-in and uses `next_step` to pick the screen:
    "name"                          -> Register: "What should Sighty call you?"
    "camera" | "microphone" | "sensor" -> that Setup screen
    "finish"                        -> "You're all set"
    null                            -> Home
"""
from flask import Blueprint, abort, g, jsonify, request

from ..auth import require_auth
from ..store import get_store

bp = Blueprint("me", __name__)

SETUP_STEPS = ("camera", "microphone", "sensor")
NAME_MAX = 60
EMAIL_MAX = 254


def next_step(user: dict) -> str | None:
    if not user["profile"]["name"]:
        return "name"
    setup = user["setup"]
    if setup["completed_at"]:
        return None
    return next((step for step in SETUP_STEPS if setup[step] == "pending"), "finish")


def me_payload(uid: str) -> dict:
    user = get_store().get_user(uid)
    return {"id": uid, **user, "next_step": next_step(user)}


@bp.get("")
@require_auth
def get_me():
    return jsonify(me_payload(g.uid))


@bp.put("")
@require_auth
def update_profile():
    """{name?, email?}. Email is display-only (Settings > Account); there is no sign-in."""
    body = request.get_json(force=True) or {}
    changes = {}
    if "name" in body:
        name = " ".join(str(body["name"] or "").split())
        if not 1 <= len(name) <= NAME_MAX:
            abort(400, description=f"name must be 1 to {NAME_MAX} characters")
        changes["name"] = name
    if "email" in body:
        email = str(body["email"] or "").strip()
        if email and ("@" not in email or len(email) > EMAIL_MAX):
            abort(400, description="email doesn't look right")
        changes["email"] = email or None
    get_store().save_section(g.uid, "profile", changes)
    return jsonify(me_payload(g.uid))
