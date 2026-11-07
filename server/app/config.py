import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    # Auth0: tenant domain (e.g. guidesight.us.auth0.com) and the API identifier (audience).
    AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "").removeprefix("https://").rstrip("/")
    AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", "")
    # Firestore storage: path to a Firebase/Google Cloud service-account JSON.
    FIREBASE_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_STT_MODEL = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2")
    # Shared secret the harness sends when it connects. Required once Auth0 is on.
    HARNESS_KEY = os.getenv("HARNESS_KEY", "")
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    PORT = int(os.getenv("PORT", "5001"))

    @classmethod
    def auth_enabled(cls) -> bool:
        return bool(cls.AUTH0_DOMAIN and cls.AUTH0_AUDIENCE)

    @classmethod
    def firestore_enabled(cls) -> bool:
        return bool(cls.FIREBASE_CREDENTIALS)
