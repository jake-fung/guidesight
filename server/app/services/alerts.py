"""Turns a vision result into what the user hears (TTS text) and feels (haptic pattern).

Speech is synthesized on the phone (expo-speech) so alerts play with no extra network
round-trip. To move TTS server-side, add a synthesize() here and return audio in the payload.
"""

# Pattern names the ESP32 firmware understands (see firmware/src/main.cpp).
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
