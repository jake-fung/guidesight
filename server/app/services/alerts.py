"""Turns a vision result into what the user hears (TTS text) and feels (haptic pattern).

The app turns the text into an ElevenLabs voice clip via /api/tts (services/tts.py), and uses the
phone's built-in voice when ElevenLabs isn't set up.
"""

# Pattern names the harness firmware understands (see firmware/uno_r4/uno_r4.ino).
HAPTIC_BY_URGENCY = {"high": "long", "medium": "double", "low": "short"}


def build_alert(scene: dict, settings: dict) -> dict:
    urgency = scene.get("urgency", "low")
    text = scene.get("alert", "")
    if settings.get("alert_verbosity") == "detailed" and scene.get("detail"):
        text = f"{text}. {scene['detail']}"
    return {
        "speak": text,
        "urgency": urgency,
        "haptic": HAPTIC_BY_URGENCY.get(urgency, "short") if settings.get("haptics_enabled") else None,
        "speech_rate": settings.get("speech_rate", 1.0),
    }
