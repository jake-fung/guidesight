"""Google Maps: find a place by name (Places API, New) and a walking route to it (Routes API).

"Where am I?" also uses the Geocoding API (street address); without it, only the nearest place is named.
Both APIs must be enabled for GOOGLE_MAPS_API_KEY in Google Cloud. A blank key = mock mode: a
made-up two-step route starting where the walker is, so guiding can be tried indoors.
"""
import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request

from ..config import Config

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
# Places near the walker win: look within this radius first.
SEARCH_RADIUS_M = 5000.0
# "Where am I?" names a place only if it's this close (metres).
NEARBY_RADIUS_M = 40.0

PLACE_FIELDS = "places.displayName,places.formattedAddress,places.location"
ROUTE_FIELDS = ",".join([
    "routes.distanceMeters", "routes.duration",
    "routes.legs.steps.distanceMeters", "routes.legs.steps.staticDuration",
    "routes.legs.steps.navigationInstruction", "routes.legs.steps.startLocation",
    "routes.legs.steps.endLocation", "routes.legs.steps.polyline",
])


class MapsError(Exception):
    """Google Maps failed or isn't reachable. The message is safe to show or speak."""


class PlaceNotFound(MapsError):
    pass


def enabled() -> bool:
    return bool(Config.GOOGLE_MAPS_API_KEY)


def _post(url: str, body: dict, field_mask: str) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": Config.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": field_mask,
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            reason = json.load(e).get("error", {}).get("message")
        except ValueError:
            reason = None
        raise MapsError(f"Google Maps error {e.code}: {reason or e.reason}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MapsError("Couldn't reach Google Maps") from e


def _get(url: str, params: dict) -> dict:
    query = urllib.parse.urlencode({**params, "key": Config.GOOGLE_MAPS_API_KEY})
    try:
        with urllib.request.urlopen(f"{url}?{query}", timeout=10) as res:
            data = json.load(res)
    except urllib.error.HTTPError as e:
        raise MapsError(f"Google Maps error {e.code}: {e.reason}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MapsError("Couldn't reach Google Maps") from e
    if data.get("status") not in ("OK", "ZERO_RESULTS"):
        raise MapsError(f"Google Maps error: {data.get('error_message') or data.get('status')}")
    return data


def _latlng(p: dict) -> dict:
    return {"lat": p["latitude"], "lng": p["longitude"]}


def decode_polyline(encoded: str) -> list[list[float]]:
    """Google's encoded polyline format -> [[lat, lng], ...]."""
    points, i, lat, lng = [], 0, 0, 0
    while i < len(encoded):
        for axis in (0, 1):
            shift = result = 0
            while True:
                b = ord(encoded[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lng += delta
        points.append([lat / 1e5, lng / 1e5])
    return points


def _seconds(duration: str | None) -> int:
    """Routes API durations look like "123s"."""
    try:
        return round(float((duration or "0s").rstrip("s")))
    except ValueError:
        return 0


def _clean(instruction: str) -> str:
    # Google puts extra hints on new lines ("Turn left onto King St\nDestination will be on the right").
    return re.sub(r"\s*\n\s*", ". ", instruction.strip())


def find_place(query: str, near: dict) -> dict:
    """Best match for "Tim Hortons" / "123 Main St" near the walker -> {name, address, location}."""
    if not enabled():
        return {"name": query, "address": "[mock] 200 m away", "location": _offset(near, 120, 80)}
    data = _post(PLACES_URL, {
        "textQuery": query,
        "pageSize": 1,
        "locationBias": {"circle": {
            "center": {"latitude": near["lat"], "longitude": near["lng"]},
            "radius": SEARCH_RADIUS_M,
        }},
    }, PLACE_FIELDS)
    places = data.get("places") or []
    if not places:
        raise PlaceNotFound(f"I couldn't find {query} near you.")
    p = places[0]
    return {
        "name": (p.get("displayName") or {}).get("text") or query,
        "address": p.get("formattedAddress", ""),
        "location": _latlng(p["location"]),
    }


def walking_route(origin: dict, destination: dict) -> dict:
    """Walking directions between two {lat, lng} -> {distance_m, duration_s, steps: [...]}."""
    if not enabled():
        return _mock_route(origin)
    data = _post(ROUTES_URL, {
        "origin": {"location": {"latLng": {"latitude": origin["lat"], "longitude": origin["lng"]}}},
        "destination": {"location": {"latLng": {"latitude": destination["lat"], "longitude": destination["lng"]}}},
        "travelMode": "WALK",
        "languageCode": "en",
        "units": "METRIC",
    }, ROUTE_FIELDS)
    routes = data.get("routes") or []
    if not routes:
        raise PlaceNotFound("I couldn't find a walking route there.")
    route = routes[0]
    steps = []
    for leg in route.get("legs", []):
        for s in leg.get("steps", []):
            nav = s.get("navigationInstruction") or {}
            points = decode_polyline((s.get("polyline") or {}).get("encodedPolyline", ""))
            start, end = _latlng(s["startLocation"]["latLng"]), _latlng(s["endLocation"]["latLng"])
            steps.append({
                "instruction": _clean(nav.get("instructions") or "Continue"),
                "maneuver": nav.get("maneuver", ""),
                "distance_m": s.get("distanceMeters", 0),
                "duration_s": _seconds(s.get("staticDuration")),
                "start": start,
                "end": end,
                "points": points or [[start["lat"], start["lng"]], [end["lat"], end["lng"]]],
            })
    return {
        "distance_m": route.get("distanceMeters", 0),
        "duration_s": _seconds(route.get("duration")),
        "steps": steps,
    }


def _street_address(here: dict) -> str | None:
    """ "123 Main Street" (or just "Main Street") for a point, from the Geocoding API."""
    data = _get(GEOCODE_URL, {"latlng": f"{here['lat']},{here['lng']}", "language": "en"})
    results = data.get("results") or []
    if not results:
        return None
    parts = {t: c["long_name"] for c in results[0].get("address_components", []) for t in c.get("types", [])}
    if parts.get("route"):
        return " ".join(p for p in (parts.get("street_number"), parts["route"]) if p)
    return (results[0].get("formatted_address") or "").split(",")[0].strip() or None


def _nearest_place(here: dict) -> str | None:
    """Name of the closest place (shop, station, park...) within NEARBY_RADIUS_M."""
    data = _post(NEARBY_URL, {
        "maxResultCount": 1,
        "rankPreference": "DISTANCE",
        "locationRestriction": {"circle": {
            "center": {"latitude": here["lat"], "longitude": here["lng"]},
            "radius": NEARBY_RADIUS_M,
        }},
    }, "places.displayName")
    places = data.get("places") or []
    return ((places[0].get("displayName") or {}).get("text") or None) if places else None


def where_am_i(here: dict) -> dict:
    """{address: "123 Main Street" | None, place: "Tim Hortons" | None} for the walker's position.

    Either lookup may fail on its own (e.g. Geocoding API not enabled); only both failing is an error.
    """
    if not enabled():
        return {"address": "[mock] 100 Queen Street West", "place": "City Hall"}
    out, errors = {}, []
    for key, lookup in (("address", _street_address), ("place", _nearest_place)):
        try:
            out[key] = lookup(here)
        except MapsError as e:
            out[key] = None
            errors.append(e)
    if len(errors) == 2:
        raise errors[0]
    return out


# ---- Mock mode -------------------------------------------------------------------------------

def _offset(p: dict, north_m: float, east_m: float) -> dict:
    return {
        "lat": p["lat"] + north_m / 111_320,
        "lng": p["lng"] + east_m / (111_320 * math.cos(math.radians(p["lat"]))),
    }


def _mock_route(origin: dict) -> dict:
    corner = _offset(origin, 120, 0)
    end = _offset(origin, 120, 80)
    pts = lambda *ps: [[p["lat"], p["lng"]] for p in ps]  # noqa: E731
    return {
        "distance_m": 200,
        "duration_s": 150,
        "steps": [
            {"instruction": "Head north on Mock Street", "maneuver": "DEPART", "distance_m": 120,
             "duration_s": 90, "start": origin, "end": corner, "points": pts(origin, corner)},
            {"instruction": "Turn right onto Demo Avenue. Destination will be on the left",
             "maneuver": "TURN_RIGHT", "distance_m": 80, "duration_s": 60,
             "start": corner, "end": end, "points": pts(corner, end)},
        ],
    }
