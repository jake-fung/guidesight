"""First-run Setup screens after sign-up: camera, microphone, sensor, then "You're all set".

The browser owns the real camera and microphone permissions (they're per device). The server keeps
what the user chose so the app can resume setup where they left off, on any device.
"""
from flask import Blueprint, abort, g, jsonify, request

from ..auth import require_auth
from ..live import buzz_user_harness, client_ip, get_hub, notify_harness_status
from ..store import get_store, now_iso
from .me import SETUP_STEPS, me_payload

bp = Blueprint("setup", __name__)

# Answers each screen accepts. A sensor becomes "connected" only through POST /sensor.
STEP_ANSWERS = {"camera": ("allowed", "skipped"), "microphone": ("allowed", "skipped"), "sensor": ("skipped",)}


@bp.put("/<step>")
@require_auth
def answer_step(step):
    """{status: "allowed" | "skipped"} for camera and microphone; {status: "skipped"} for sensor."""
    if step not in STEP_ANSWERS:
        abort(404, description=f"setup step must be one of: {', '.join(STEP_ANSWERS)}")
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in STEP_ANSWERS[step]:
        abort(400, description=f"status for {step} must be one of: {', '.join(STEP_ANSWERS[step])}")
    get_store().save_section(g.uid, "setup", {step: status})
    return jsonify(me_payload(g.uid))


@bp.get("/sensor")
@require_auth
def find_sensor():
    """Polled while "Connect your sensor" shows "Searching…".

    {harness_id, online, nearby: [{id, same_network}]}. `nearby` lists switched-on sensors nobody has
    paired yet, those on the same network as the phone first. The app pairs one with POST /sensor
    (automatically if there's exactly one).
    """
    store, hub = get_store(), get_hub()
    harness_id = store.get_settings(g.uid).get("harness_id")
    my_ip = client_ip()
    nearby = [
        {"id": hid, "same_network": bool(ip) and ip == my_ip}
        for hid, ip in hub.online_harnesses().items()
        if hid != harness_id and store.find_harness_owner(hid) is None
    ]
    nearby.sort(key=lambda h: (not h["same_network"], h["id"]))
    return jsonify(harness_id=harness_id, online=hub.is_online(harness_id), nearby=nearby)


@bp.post("/sensor")
@require_auth
def pair_sensor():
    """{harness_id} -> pairs a switched-on sensor and buzzes it so the user feels it's theirs."""
    store = get_store()
    harness_id = str((request.get_json(silent=True) or {}).get("harness_id") or "").strip()
    if not harness_id:
        abort(400, description="harness_id is required")
    if store.harness_taken(g.uid, harness_id):
        abort(409, description="that sensor is paired with another account")
    if not get_hub().is_online(harness_id):
        abort(404, description="that sensor isn't switched on or isn't online")

    settings = store.save_settings(g.uid, {"harness_id": harness_id})
    store.save_section(g.uid, "setup", {"sensor": "connected"})
    notify_harness_status(g.uid, harness_id)
    buzzed = buzz_user_harness(g.uid, "double", settings)
    return jsonify(harness_id=harness_id, online=True, buzzed=buzzed, me=me_payload(g.uid))


@bp.post("/complete")
@require_auth
def complete():
    """The "Done" button on "You're all set". Steps still pending count as skipped."""
    store = get_store()
    user = store.get_user(g.uid)
    if not user["profile"]["name"]:
        abort(400, description="set a name first (PUT /api/me)")
    changes = {step: "skipped" for step in SETUP_STEPS if user["setup"][step] == "pending"}
    if not user["setup"]["completed_at"]:
        changes["completed_at"] = now_iso()
    store.save_section(g.uid, "setup", changes)
    return jsonify(me_payload(g.uid))
