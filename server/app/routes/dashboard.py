"""Walk Dashboard API: stop events for the map, dog activity & fatigue, route hotspots."""
from collections import Counter
from datetime import datetime

from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..store import get_store

bp = Blueprint("dashboard", __name__)

HOTSPOT_PRECISION = 3  # decimal places of lat/lng, ~100 m grid cells


def _minutes(walk) -> float:
    if not walk.get("ended_at"):
        return 0.0
    start = datetime.fromisoformat(walk["started_at"])
    end = datetime.fromisoformat(walk["ended_at"])
    return max((end - start).total_seconds() / 60, 0.0)


def fatigue_score(walk, events) -> float | None:
    """0..1. Rough heuristic: are stops more frequent in the second half of the walk than the first?

    TODO: replace with a model using MPU6050 gait data (stride cadence, pull strength over time).
    """
    stops = [e for e in events if e["type"] == "stop"]
    if len(stops) < 4 or not walk.get("ended_at"):
        return None
    mid = datetime.fromisoformat(walk["started_at"]) + (
        datetime.fromisoformat(walk["ended_at"]) - datetime.fromisoformat(walk["started_at"])) / 2
    first = sum(1 for e in stops if datetime.fromisoformat(e["at"]) < mid)
    second = len(stops) - first
    return round(min(max((second - first) / len(stops), 0.0), 1.0), 2)


@bp.get("/summary")
@require_auth
def summary():
    store = get_store()
    walks = store.list_walks(g.uid, limit=int(request.args.get("limit", 20)))

    stop_points, walk_stats, cells = [], [], Counter()
    for walk in walks:
        events = store.list_events(g.uid, walk["id"])
        for e in events:
            loc = e.get("location")
            if e["type"] in ("stop", "pull") and loc:
                stop_points.append({"walk_id": walk["id"], "type": e["type"], "at": e["at"], **loc})
                cells[(round(loc["lat"], HOTSPOT_PRECISION), round(loc["lng"], HOTSPOT_PRECISION))] += 1
        walk_stats.append({
            "id": walk["id"],
            "started_at": walk["started_at"],
            "minutes": round(_minutes(walk), 1),
            "stops": walk.get("stop_count", 0),
            "pulls": walk.get("pull_count", 0),
            "fatigue": fatigue_score(walk, events),
        })

    hotspots = [{"lat": lat, "lng": lng, "count": n} for (lat, lng), n in cells.most_common(10) if n > 1]
    return jsonify(walks=walk_stats, stops=stop_points, hotspots=hotspots)
