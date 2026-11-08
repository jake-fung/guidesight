"""Walking directions for Guide mode (Google Maps, services/maps.py)."""
from flask import Blueprint, abort, jsonify, request

from ..auth import require_auth
from ..services import maps

bp = Blueprint("routes", __name__)


def _point(value, name):
    try:
        lat, lng = float(value["lat"]), float(value["lng"])
    except (KeyError, TypeError, ValueError):
        abort(400, description=f"{name} must be {{lat, lng}}")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        abort(400, description=f"{name} is out of range")
    return {"lat": lat, "lng": lng}


@bp.post("")
@require_auth
def plan_route():
    """{origin: {lat, lng}, destination: "Tim Hortons" | {lat, lng, name?}} ->
    {destination: {name, address, location}, distance_m, duration_s, steps: [...]}

    A text destination is looked up near the origin. Pass {lat, lng} (from an earlier answer) to
    re-route to the same place after the walker goes off the route.
    """
    body = request.get_json(force=True, silent=True) or {}
    origin = _point(body.get("origin"), "origin")
    dest = body.get("destination")
    try:
        if isinstance(dest, str) and dest.strip():
            place = maps.find_place(dest.strip()[:200], origin)
        elif isinstance(dest, dict):
            place = {"name": str(dest.get("name") or "your destination"), "address": str(dest.get("address") or ""),
                     "location": _point(dest, "destination")}
        else:
            abort(400, description="destination is required")
        route = maps.walking_route(origin, place["location"])
    except maps.PlaceNotFound as e:
        abort(404, description=str(e))
    except maps.MapsError as e:
        abort(502, description=str(e))
    return jsonify(destination=place, **route)
