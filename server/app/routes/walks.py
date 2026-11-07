"""Live Walk API: the walker web app streams frames, voice clips and harness events here."""
import base64

from flask import Blueprint, abort, g, jsonify, request

from ..auth import require_auth
from ..live import HARNESS_EVENT_TYPES, buzz_user_harness
from ..services import stt, vision
from ..services.alerts import build_alert
from ..store import get_store

bp = Blueprint("walks", __name__)

def _walk_or_404(walk_id):
    walk = get_store().get_walk(g.uid, walk_id)
    if walk is None:
        abort(404, description="walk not found")
    return walk


@bp.post("")
@require_auth
def start_walk():
    return jsonify(get_store().create_walk(g.uid)), 201


@bp.post("/<walk_id>/end")
@require_auth
def end_walk(walk_id):
    _walk_or_404(walk_id)
    return jsonify(get_store().end_walk(g.uid, walk_id))


@bp.get("/<walk_id>")
@require_auth
def get_walk(walk_id):
    walk = _walk_or_404(walk_id)
    return jsonify(walk=walk, events=get_store().list_events(g.uid, walk_id))


@bp.post("/<walk_id>/harness-event")
@require_auth
def harness_event(walk_id):
    """Sent by the phone when the harness reports one over the live link (app/live.py), with the
    phone's GPS fix: {type: "stop"|"pull"|"obstacle", motion: {...}, location}.

    The UNO R4 harness sends obstacle ({cm}) from its HC-SR04; stop/pull ({accel}) are for a motion sensor.
    """
    _walk_or_404(walk_id)
    body = request.get_json(force=True)
    if body.get("type") not in HARNESS_EVENT_TYPES:
        abort(400, description="type must be 'stop', 'pull' or 'obstacle'")
    event = get_store().add_event(g.uid, walk_id, {
        "type": body["type"],
        "motion": body.get("motion"),
        "location": body.get("location"),
    })
    settings = get_store().get_settings(g.uid)
    # Tell the phone whether to grab a frame and send it to /frame.
    return jsonify(event=event, capture_frame=bool(settings.get("auto_describe_on_stop"))), 201


@bp.post("/<walk_id>/frame")
@require_auth
def frame(walk_id):
    """{image: <base64 jpeg>, trigger: "stop"|"pull"|"obstacle"|"periodic"|"manual", location} -> spoken alert."""
    _walk_or_404(walk_id)
    body = request.get_json(force=True)
    try:
        image = base64.b64decode(body["image"])
    except (KeyError, ValueError):
        abort(400, description="image (base64 jpeg) is required")

    scene = vision.describe_scene(image, body.get("trigger", "stop"))
    settings = get_store().get_settings(g.uid)
    alert = build_alert(scene, settings)
    if alert["haptic"]:
        buzz_user_harness(g.uid, alert["haptic"], settings)  # straight to the harness, no phone round trip
    get_store().add_event(g.uid, walk_id, {
        "type": "alert",
        "text": alert["speak"],
        "hazards": scene.get("hazards", []),
        "text_seen": scene.get("text_seen", []),
        "urgency": alert["urgency"],
        "location": body.get("location"),
    })
    return jsonify(alert=alert, scene=scene)


@bp.post("/<walk_id>/voice")
@require_auth
def voice(walk_id):
    """multipart/form-data: audio (required), image (optional jpeg), lat/lng (optional)."""
    _walk_or_404(walk_id)
    audio = request.files.get("audio")
    if audio is None:
        abort(400, description="audio file is required")
    image = request.files.get("image")

    question = stt.transcribe(audio.read())
    answer = vision.answer_question(image.read() if image else None, question)
    settings = get_store().get_settings(g.uid)
    location = None
    if request.form.get("lat") and request.form.get("lng"):
        location = {"lat": float(request.form["lat"]), "lng": float(request.form["lng"])}

    get_store().add_event(g.uid, walk_id, {
        "type": "question", "text": question, "answer": answer, "location": location,
    })
    return jsonify(
        transcript=question,
        alert={"speak": answer, "urgency": "low", "haptic": None,
               "speech_rate": settings.get("speech_rate", 1.0)},
    )
