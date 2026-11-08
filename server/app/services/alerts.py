"""Turns a vision result into what the user hears (TTS text) and feels (haptic pattern).

The app turns the text into an ElevenLabs voice clip via /api/tts (services/tts.py), and uses the
phone's built-in voice when ElevenLabs isn't set up.
"""

# Pattern names the harness firmware understands (see firmware/uno_r4/uno_r4.ino).
HAPTIC_BY_URGENCY = {"high": "long", "medium": "double", "low": "short"}


AVOID = ("left", "right", "stop", "none")

# Stairs and drop-offs only force the stop screen this close (metres). Further away they're spoken.
DROP_STOP_M = 1.0


def _obstacle(scene: dict) -> dict | None:
    """The model's nearest obstacle, checked: {what, distance_m?, clock?} or None."""
    o = scene.get("obstacle")
    if not isinstance(o, dict) or not str(o.get("what") or "").strip():
        return None
    out = {"what": str(o["what"]).strip()[:40]}
    try:
        out["distance_m"] = round(max(0.0, float(o["distance_m"])), 1)
    except (KeyError, TypeError, ValueError):
        pass
    try:
        clock = round(float(o["clock"]))
        if 1 <= clock <= 12:
            out["clock"] = clock
    except (KeyError, TypeError, ValueError):
        pass
    return out


def _danger(scene: dict) -> str | None:
    d = scene.get("danger")
    if not isinstance(d, str) or d.strip().lower() in ("", "none", "null", "no"):
        return None
    return d.strip()[:60]


def _drop(scene: dict) -> dict | None:
    """Stairs or a drop-off the model saw: {what, distance_m?} or None."""
    d = scene.get("drop")
    if not isinstance(d, dict) or not str(d.get("what") or "").strip():
        return None
    out = {"what": str(d["what"]).strip()[:40]}
    try:
        out["distance_m"] = round(max(0.0, float(d["distance_m"])), 1)
    except (KeyError, TypeError, ValueError):
        pass
    return out


def build_alert(scene: dict, settings: dict) -> dict:
    drop = _drop(scene)
    danger = _danger(scene)
    # Stairs and drop-offs are always high urgency, but only a danger (stop screen) when about to
    # reach them. No distance counts as close, to be safe.
    urgency = "high" if drop else scene.get("urgency", "low")
    if drop and drop.get("distance_m", 0) <= DROP_STOP_M:
        danger = drop["what"]
    text = scene.get("alert", "")
    if settings.get("alert_verbosity") == "detailed" and scene.get("detail"):
        text = f"{text}. {scene['detail']}"
    return {
        "speak": text,
        "urgency": urgency,
        "haptic": HAPTIC_BY_URGENCY.get(urgency, "short") if settings.get("haptics_enabled") else None,
        "speech_rate": settings.get("speech_rate", 1.0),
        # For obstacle avoidance on the phone: what's in the way and which way to step around it.
        "obstacle": _obstacle(scene),
        "avoid": scene.get("avoid") if scene.get("avoid") in AVOID else None,
        # Stairs or a drop-off at any distance; the app watches it more closely as they get near.
        "drop": drop,
        # Stop right away, however far it is (red light, moving traffic), or stairs/a drop within 1 m.
        "danger": danger,
    }
