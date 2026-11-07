"""Gemini Vision: describe the scene, flag obstacles, read signs and bus numbers."""
import json

from ..config import Config

SCENE_PROMPT = """You are the eyes of a blind pedestrian walking with a guide dog.
What just happened: {trigger}. Look at this street-level photo from their chest-mounted phone.
Return JSON with:
  "alert":     one short spoken warning, max 8 words, most urgent thing first (e.g. "Curb ahead, step down")
  "detail":    one or two sentences describing the scene for a follow-up
  "hazards":   list of short strings (curb, stairs, pole, vehicle, construction, ...)
  "text_seen": list of readable signs or bus route numbers
  "urgency":   "low" | "medium" | "high"
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

        _client = genai.Client(api_key=Config.GEMINI_API_KEY)
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
            "alert": "Curb ahead, step down",
            "detail": "[mock] A sidewalk ending at a curb with a crosswalk ahead.",
            "hazards": ["curb"],
            "text_seen": [],
            "urgency": "medium",
        }
    return _ask(image, SCENE_PROMPT.format(trigger=TRIGGER_TEXT.get(trigger, trigger)))


def answer_question(image: bytes | None, question: str) -> str:
    if not Config.GEMINI_API_KEY:
        return f"[mock] You asked: {question}. The bus in front of you shows route 42."
    if image is None:
        return "I don't have a camera view right now. Point the phone forward and ask again."
    return _ask(image, QUESTION_PROMPT.format(question=question)).get("answer", "")
