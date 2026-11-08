import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    # Firestore storage: path to a Firebase/Google Cloud service-account JSON.
    FIREBASE_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    # true when GEMINI_API_KEY is a Google Cloud Agent Platform (Vertex AI) key, not an AI Studio key.
    GEMINI_VERTEX = os.getenv("GEMINI_VERTEX", "").strip().lower() in ("1", "true", "yes")
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_STT_MODEL = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2")
    ELEVENLABS_REALTIME_STT_MODEL = os.getenv("ELEVENLABS_REALTIME_STT_MODEL", "scribe_v2_realtime")
    # Spoken alerts. Flash is ElevenLabs' lowest-latency model; the voice is a premade one (George).
    ELEVENLABS_TTS_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5")
    ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    # Shared secret the harness sends when it connects. Blank = any harness may connect.
    HARNESS_KEY = os.getenv("HARNESS_KEY", "")
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    PORT = int(os.getenv("PORT", "5001"))

    @classmethod
    def firestore_enabled(cls) -> bool:
        return bool(cls.FIREBASE_CREDENTIALS)
