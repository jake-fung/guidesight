"""Gemini Vision: describe the scene, flag obstacles, read signs and bus numbers."""
import json

from ..config import Config

SCENE_PROMPT = """You are the eyes of a blind pedestrian walking with a guide dog.
What just happened: {trigger}. Look at this street-level photo from their chest-mounted phone.
Return JSON with:
  "alert":     one short spoken warning, max 10 words, most urgent thing first. When something is in
               their path, say what it is, how far in metres, and which way to step
               (e.g. "Pole 2 metres ahead, step right", "Curb in 3 metres, step down")
  "detail":    one or two sentences describing the scene for a follow-up
  "hazards":   list of short strings (curb, stairs, pole, vehicle, construction, ...)
  "text_seen": list of readable signs or bus route numbers
  "urgency":   "low" | "medium" | "high" (high = they could hit it within about 2 metres)
  "obstacle":  the nearest thing in their walking path, or null. {{"what": "pole", "distance_m": 2,
               "clock": 11}} where clock is its direction as a clock face (12 = straight ahead,
               3 = right, 9 = left) and distance_m is your best estimate
  "avoid":     how to get past that obstacle: "left" | "right" | "stop" (wait, no way around) | "none"
  "drop":      null, or stairs (up or down) or a vertical drop-off in or next to their path: a ledge,
               platform edge, steep bank, cliff, loading dock, missing paving. {{"what": "stairs going
               down", "distance_m": 3}}, distance_m being your best estimate to the first step or edge.
               An ordinary curb is not a drop. If there is a drop, set urgency to "high".
  "trip":      null, or something low in their walking path they could trip on or that changes the
               ground level: a ramp going up or down, a single step, a curb, a raised or broken paving
               slab, a pothole, a cable or hose across the path, a low object on the ground.
               {{"what": "ramp going down", "distance_m": 2}}. Stairs and drop-offs go in "drop", not
               here. Upright things (poles, doors, door frames, people, furniture) are NOT trip hazards.
  "view":      "ok" if you can see the way ahead. "blocked" if the lens is covered, or it's too dark or
               blurry to see anything. "away" if the camera points at the sky, straight down at the
               ground or at their body, so the path ahead isn't in the photo.
  "danger":    null, or a few words naming something that means they must stop now even if it is far
               away: a red or don't-walk signal, moving traffic or a vehicle crossing their path, a
               level crossing, an open hole or construction pit. Stairs and drop-offs go in "drop",
               not here. Ordinary obstacles they can step around (poles, bins, people) are NOT a danger.
"""

QUESTION_PROMPT = """You are the eyes of a blind pedestrian. They asked: "{question}"
Answer in one or two short spoken sentences using only what is visible in this photo.
If you cannot tell, say so plainly. Return JSON: {{"answer": "..."}}"""

TRIGGER_TEXT = {
    "stop": "the guide dog stopped",
    "pull": "the guide dog pulled sharply",
    "obstacle": "an ultrasonic sensor detected something close ahead; identify it first",
    "periodic": "they are walking normally (routine check)",
    "manual": "they asked for a description of the surroundings",
}

_client = None


def _gemini():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(vertexai=Config.GEMINI_VERTEX, api_key=Config.GEMINI_API_KEY)
    return _client


def _ask(image: bytes, prompt: str) -> dict:
    from google.genai import types

    resp = _gemini().models.generate_content(
        model=Config.GEMINI_MODEL,
        contents=[types.Part.from_bytes(data=image, mime_type="image/jpeg"), prompt],
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
    )
    return json.loads(resp.text)


def describe_scene(image: bytes, trigger: str = "stop") -> dict:
    if not Config.GEMINI_API_KEY:
        return {
            "alert": "Pole 2 metres ahead, step right",
            "detail": "[mock] A sidewalk with a pole slightly to the left and a crosswalk ahead.",
            "hazards": ["pole"],
            "text_seen": [],
            "urgency": "medium",
            "obstacle": {"what": "pole", "distance_m": 2, "clock": 11},
            "avoid": "right",
            "drop": None,
            "trip": None,
            "view": "ok",
            "danger": None,
        }
    return _ask(image, SCENE_PROMPT.format(trigger=TRIGGER_TEXT.get(trigger, trigger)))


def answer_question(image: bytes | None, question: str) -> str:
    if not Config.GEMINI_API_KEY:
        return f"[mock] You asked: {question}. The bus in front of you shows route 42."
    if image is None:
        return "I don't have a camera view right now. Point the phone forward and ask again."
    return _ask(image, QUESTION_PROMPT.format(question=question)).get("answer", "")
