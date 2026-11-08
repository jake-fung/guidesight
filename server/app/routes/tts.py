"""Spoken alerts in an ElevenLabs voice. The app falls back to the phone's own voice on any error."""
from flask import Blueprint, Response, abort, g, request

from ..auth import require_auth
from ..services import tts
from ..store import get_store

bp = Blueprint("tts", __name__)


@bp.post("")
@require_auth
def speak():
    if not tts.enabled():
        abort(503, description="text-to-speech is not set up (ELEVENLABS_API_KEY)")
    body = request.get_json(force=True, silent=True) or {}
    text = str(body.get("text") or "").strip()
    if not text:
        abort(400, description="text is required")
    speed = body.get("speed", 1.0)
    if isinstance(speed, bool) or not isinstance(speed, (int, float)):
        abort(400, description="speed must be a number")

    # A voice picked in Settings is an ElevenLabs voice ID; "default" uses the server's voice.
    voice = get_store().get_settings(g.uid).get("voice")
    try:
        audio = tts.synthesize(text, float(speed), None if voice in (None, "", "default") else voice)
    except Exception as e:  # network or ElevenLabs error
        abort(502, description=f"text-to-speech failed: {e}")
    return Response(audio, mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})
