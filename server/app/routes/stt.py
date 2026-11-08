"""Speech-to-text via ElevenLabs Scribe.

POST /api/stt: the phone records one phrase at a time and sends it here, because Safari's own
speech recognition is too unreliable for always-on listening.
POST /api/stt/token: a single-use token for live transcription, where the phone streams the mic
straight to ElevenLabs (used by voice setup, so answers appear word by word).
"""
from flask import Blueprint, abort, jsonify, request

from ..auth import require_auth
from ..config import Config
from ..services import stt

bp = Blueprint("stt", __name__)


@bp.post("")
@require_auth
def transcribe():
    """multipart/form-data: audio (one short phrase). Returns {transcript}."""
    if not Config.ELEVENLABS_API_KEY:
        abort(503, description="speech-to-text is not set up (ELEVENLABS_API_KEY)")
    audio = request.files.get("audio")
    if audio is None:
        abort(400, description="audio file is required")
    try:
        text = stt.transcribe(audio.read())
    except Exception as e:  # network or ElevenLabs error
        abort(502, description=f"speech-to-text failed: {e}")
    return jsonify(transcript=text)


@bp.post("/token")
@require_auth
def realtime_token():
    """Returns {token, model_id} for wss://api.elevenlabs.io/v1/speech-to-text/realtime."""
    if not Config.ELEVENLABS_API_KEY:
        abort(503, description="speech-to-text is not set up (ELEVENLABS_API_KEY)")
    try:
        token = stt.realtime_token()
    except Exception as e:  # network or ElevenLabs error
        abort(502, description=f"speech-to-text token failed: {e}")
    return jsonify(token=token, model_id=Config.ELEVENLABS_REALTIME_STT_MODEL)
