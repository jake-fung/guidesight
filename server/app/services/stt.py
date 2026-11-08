"""Speech-to-text: turns voice questions like "which bus is this?" into text via ElevenLabs Scribe."""
import io

from ..config import Config


def transcribe(audio: bytes) -> str:
    if not Config.ELEVENLABS_API_KEY:
        return "Which bus is this?"  # mock

    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=Config.ELEVENLABS_API_KEY)
    result = client.speech_to_text.convert(
        file=io.BytesIO(audio),
        model_id=Config.ELEVENLABS_STT_MODEL,
        tag_audio_events=False,
    )
    return (getattr(result, "text", "") or "").strip()


REALTIME_TOKEN_URL = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"


def realtime_token() -> str:
    """A single-use token (15 min) that lets the phone stream audio straight to ElevenLabs
    Scribe realtime, so words appear while the person is still talking."""
    import json
    import urllib.request

    req = urllib.request.Request(
        REALTIME_TOKEN_URL, method="POST", headers={"xi-api-key": Config.ELEVENLABS_API_KEY}
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)["token"]
