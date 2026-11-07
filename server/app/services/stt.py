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
