import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    FIREBASE_CREDENTIALS = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    PORT = int(os.getenv("PORT", "5001"))

    @classmethod
    def firebase_enabled(cls) -> bool:
        return bool(cls.FIREBASE_CREDENTIALS)
