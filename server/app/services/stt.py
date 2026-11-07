"""Speech-to-text: turns voice questions like "which bus is this?" into text via AssemblyAI."""
from ..config import Config


def transcribe(audio: bytes) -> str:
    if not Config.ASSEMBLYAI_API_KEY:
        return "Which bus is this?"  # mock

    import assemblyai as aai

    aai.settings.api_key = Config.ASSEMBLYAI_API_KEY
    transcript = aai.Transcriber().transcribe(audio)
    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(transcript.error)
    return transcript.text or ""
