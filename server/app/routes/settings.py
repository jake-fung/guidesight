"""Voice, alert and accessibility preferences (Settings screen and the accessibility shortcut)."""
from flask import Blueprint, abort, g, jsonify, request

from ..auth import require_auth
from ..live import notify_harness_status
from ..store import DEFAULT_SETTINGS, get_store

bp = Blueprint("settings", __name__)

BOOL_KEYS = {"haptics_enabled", "auto_describe_on_stop", "high_contrast", "read_screen_aloud", "zoom",
             "voice_control"}
CHOICES = {"alert_verbosity": ("short", "detailed"), "text_size": ("default", "large", "extra_large")}
SPEECH_RATE_RANGE = (0.5, 2.0)


def clean_settings(body: dict) -> dict:
    """Known keys only, with values checked. Aborts with 400 on a bad value."""
    out = {}
    for key, value in body.items():
        if key not in DEFAULT_SETTINGS:
            continue
        if key in BOOL_KEYS and not isinstance(value, bool):
            abort(400, description=f"{key} must be true or false")
        if key in CHOICES and value not in CHOICES[key]:
            abort(400, description=f"{key} must be one of: {', '.join(CHOICES[key])}")
        if key == "speech_rate":
            low, high = SPEECH_RATE_RANGE
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
                abort(400, description=f"speech_rate must be a number from {low} to {high}")
            value = float(value)
        if key == "voice" and not isinstance(value, str):
            abort(400, description="voice must be a string")
        if key == "harness_id":
            value = str(value or "").strip() or None
        out[key] = value
    return out


@bp.get("")
@require_auth
def get_settings():
    return jsonify(get_store().get_settings(g.uid))


@bp.put("")
@require_auth
def update_settings():
    store = get_store()
    changes = clean_settings(request.get_json(force=True) or {})
    if "harness_id" in changes and store.harness_taken(g.uid, changes["harness_id"]):
        abort(409, description="that harness is paired with another account")
    settings = store.save_settings(g.uid, changes)
    if "harness_id" in changes:
        notify_harness_status(g.uid, settings["harness_id"])
    return jsonify(settings)
