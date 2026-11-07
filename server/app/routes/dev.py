"""Mock-mode only: fills the in-memory store with demo walks so the dashboard has data."""
import random
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify

from ..auth import require_auth
from ..store import get_store

bp = Blueprint("dev", __name__)

# A few corners in downtown Toronto; swap for your own test route.
CORNERS = [(43.6532, -79.3832), (43.6545, -79.3807), (43.6561, -79.3802), (43.6519, -79.3870)]


@bp.post("/seed")
@require_auth
def seed():
    store = get_store()
    rng = random.Random(42)
    for day in range(5):
        walk = store.create_walk(g.uid)
        start = datetime.now(timezone.utc) - timedelta(days=day, minutes=40)
        walk["started_at"] = start.isoformat()
        for i in range(rng.randint(4, 9)):
            lat, lng = rng.choice(CORNERS)
            event = store.add_event(g.uid, walk["id"], {
                "type": rng.choice(["obstacle", "obstacle", "stop", "pull"]),
                "location": {"lat": lat + rng.uniform(-2e-4, 2e-4), "lng": lng + rng.uniform(-2e-4, 2e-4)},
                "motion": {"accel": round(rng.uniform(0.05, 7), 2)},
            })
            event["at"] = (start + timedelta(minutes=4 * i + rng.uniform(0, 3))).isoformat()
        walk["ended_at"] = (start + timedelta(minutes=35)).isoformat()
    return jsonify(ok=True, walks=len(store.list_walks(g.uid)))
