"""Text-to-speech: turns alert text into an MP3 clip in an ElevenLabs voice."""
from ..config import Config

# ElevenLabs only accepts voice speeds in this range. The app plays the clip faster or slower
# on the phone to reach speech_rate values outside it.
SPEED_RANGE = (0.7, 1.2)
MAX_CHARS = 1000


def enabled() -> bool:
    return bool(Config.ELEVENLABS_API_KEY)


def synthesize(text: str, speed: float = 1.0, voice_id: str | None = None) -> bytes:
    from elevenlabs import VoiceSettings
    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=Config.ELEVENLABS_API_KEY)
    low, high = SPEED_RANGE
    chunks = client.text_to_speech.convert(
        voice_id=voice_id or Config.ELEVENLABS_VOICE_ID,
        text=text[:MAX_CHARS],
        model_id=Config.ELEVENLABS_TTS_MODEL,
        output_format="mp3_44100_128",
        voice_settings=VoiceSettings(speed=min(max(speed, low), high)),
    )
    return b"".join(chunks)
