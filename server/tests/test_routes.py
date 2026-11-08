import pytest

from app import create_app
from app.config import Config
from app.services import maps

AUTH = {"Authorization": "Bearer test-token"}
HERE = {"lat": 43.6532, "lng": -79.3832}


@pytest.fixture
def client():
    return create_app(testing=True).test_client()


def test_mock_route_by_name(client):
    r = client.post("/api/routes", headers=AUTH, json={"origin": HERE, "destination": "Tim Hortons"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["destination"]["name"] == "Tim Hortons"
    assert body["distance_m"] == 200 and len(body["steps"]) == 2
    first = body["steps"][0]
    assert first["points"][0] == [HERE["lat"], HERE["lng"]] and first["instruction"].startswith("Head north")


def test_reroute_to_known_place(client):
    dest = {"lat": 43.6545, "lng": -79.3820, "name": "Library"}
    r = client.post("/api/routes", headers=AUTH, json={"origin": HERE, "destination": dest})
    assert r.get_json()["destination"]["name"] == "Library"
    assert r.get_json()["destination"]["location"] == {"lat": 43.6545, "lng": -79.3820}


@pytest.mark.parametrize("body", [
    {"destination": "x"},
    {"origin": {"lat": "north"}, "destination": "x"},
    {"origin": {"lat": 100, "lng": 0}, "destination": "x"},
    {"origin": HERE},
    {"origin": HERE, "destination": "   "},
])
def test_bad_requests(client, body):
    assert client.post("/api/routes", headers=AUTH, json=body).status_code == 400


def test_requires_auth(client):
    assert client.post("/api/routes", json={"origin": HERE, "destination": "x"}).status_code == 401


def test_decode_polyline():
    # Example from Google's polyline docs.
    assert maps.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == [
        [38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]


def test_google_responses_are_parsed(client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "key")
    sent = []

    def fake_post(url, body, fields):
        sent.append((url, body))
        if url == maps.PLACES_URL:
            return {"places": [{"displayName": {"text": "Union Station"}, "formattedAddress": "65 Front St W",
                                "location": {"latitude": 43.6453, "longitude": -79.3806}}]}
        return {"routes": [{"distanceMeters": 950, "duration": "780s", "legs": [{"steps": [{
            "distanceMeters": 950, "staticDuration": "780s",
            "navigationInstruction": {"maneuver": "DEPART", "instructions": "Head south on Bay St\nPass by a bank"},
            "startLocation": {"latLng": {"latitude": 43.6532, "longitude": -79.3832}},
            "endLocation": {"latLng": {"latitude": 43.6453, "longitude": -79.3806}},
            "polyline": {"encodedPolyline": "_p~iF~ps|U_ulLnnqC"},
        }]}]}]}

    monkeypatch.setattr(maps, "_post", fake_post)
    body = client.post("/api/routes", headers=AUTH, json={"origin": HERE, "destination": "union station"}).get_json()
    assert body["destination"]["name"] == "Union Station"
    assert body["duration_s"] == 780
    step = body["steps"][0]
    assert step["instruction"] == "Head south on Bay St. Pass by a bank"
    assert step["points"] == [[38.5, -120.2], [40.7, -120.95]]
    assert sent[1][1]["travelMode"] == "WALK"
    assert sent[0][1]["locationBias"]["circle"]["center"] == {"latitude": HERE["lat"], "longitude": HERE["lng"]}


def test_place_not_found(client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "key")
    monkeypatch.setattr(maps, "_post", lambda *a: {})
    r = client.post("/api/routes", headers=AUTH, json={"origin": HERE, "destination": "nowhere"})
    assert r.status_code == 404 and "couldn't find nowhere" in r.get_json()["error"]


def test_frame_alert_has_avoidance(client):
    import base64
    wid = client.post("/api/walks", headers=AUTH).get_json()["id"]
    image = base64.b64encode(b"\xff\xd8\xff fake").decode()
    alert = client.post(f"/api/walks/{wid}/frame", headers=AUTH, json={"image": image, "trigger": "obstacle"}).get_json()["alert"]
    assert alert["avoid"] == "right" and alert["obstacle"] == {"what": "pole", "distance_m": 2.0, "clock": 11}
    assert alert["danger"] is None and alert["drop"] is None and alert["trip"] is None


@pytest.mark.parametrize("danger, expected", [
    ("Red light", "Red light"), ("  moving traffic ", "moving traffic"), ("none", None), (None, None), (3, None),
])
def test_danger_is_passed_on(danger, expected):
    from app.services.alerts import build_alert
    alert = build_alert({"alert": "Stop", "urgency": "high", "danger": danger}, {})
    assert alert["danger"] == expected


@pytest.mark.parametrize("distance, danger", [(3, None), (1.0, "stairs going down"), (0.4, "stairs going down")])
def test_drop_only_stops_when_close(distance, danger):
    from app.services.alerts import build_alert
    scene = {"alert": "Stairs ahead", "urgency": "medium", "drop": {"what": "stairs going down", "distance_m": distance}}
    alert = build_alert(scene, {"haptics_enabled": True})
    assert alert["urgency"] == "high" and alert["haptic"] == "long"
    assert alert["drop"] == {"what": "stairs going down", "distance_m": float(distance)}
    assert alert["danger"] == danger


def test_drop_without_distance_counts_as_close():
    from app.services.alerts import build_alert
    alert = build_alert({"alert": "Edge", "drop": {"what": "ledge"}, "danger": "red light"}, {})
    assert alert["danger"] == "ledge" and alert["drop"] == {"what": "ledge"}


@pytest.mark.parametrize("drop", [None, {}, {"what": "  "}, "stairs"])
def test_bad_drop_is_ignored(drop):
    from app.services.alerts import build_alert
    alert = build_alert({"alert": "Clear", "urgency": "low", "drop": drop}, {})
    assert alert["drop"] is None and alert["danger"] is None and alert["urgency"] == "low"


def test_trip_is_passed_on_without_stopping():
    from app.services.alerts import build_alert
    alert = build_alert({"alert": "Ramp ahead", "urgency": "medium", "trip": {"what": "ramp going down", "distance_m": 0.5}}, {})
    assert alert["trip"] == {"what": "ramp going down", "distance_m": 0.5}
    assert alert["danger"] is None and alert["drop"] is None


@pytest.mark.parametrize("trip", [None, {}, {"what": ""}, "curb"])
def test_bad_trip_is_ignored(trip):
    from app.services.alerts import build_alert
    assert build_alert({"alert": "Clear", "trip": trip}, {})["trip"] is None


@pytest.mark.parametrize("view, expected", [("ok", "ok"), ("blocked", "blocked"), ("away", "away"), ("weird", "ok"), (None, "ok")])
def test_view_is_passed_on(view, expected):
    from app.services.alerts import build_alert
    assert build_alert({"alert": "", "view": view}, {})["view"] == expected


def test_where_am_i_mock(client):
    r = client.post("/api/routes/where", headers=AUTH, json=HERE)
    assert r.status_code == 200 and r.get_json() == {"address": "[mock] 100 Queen Street West", "place": "City Hall"}


def test_where_am_i_bad_location(client):
    assert client.post("/api/routes/where", headers=AUTH, json={"lat": "x"}).status_code == 400


def test_where_am_i_google(client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "key")
    monkeypatch.setattr(maps, "_get", lambda url, params: {"status": "OK", "results": [{
        "formatted_address": "123 Main St, Toronto, ON",
        "address_components": [
            {"long_name": "123", "types": ["street_number"]},
            {"long_name": "Main Street", "types": ["route"]},
        ],
    }]})
    monkeypatch.setattr(maps, "_post", lambda url, body, fields: {"places": [{"displayName": {"text": "Tim Hortons"}}]})
    assert client.post("/api/routes/where", headers=AUTH, json=HERE).get_json() == {"address": "123 Main Street", "place": "Tim Hortons"}


def test_where_am_i_survives_one_lookup_failing(client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "key")

    def no_geocoding(url, params):
        raise maps.MapsError("Geocoding API not enabled")
    monkeypatch.setattr(maps, "_get", no_geocoding)
    monkeypatch.setattr(maps, "_post", lambda url, body, fields: {})
    assert client.post("/api/routes/where", headers=AUTH, json=HERE).get_json() == {"address": None, "place": None}


def test_where_am_i_both_failing(client, monkeypatch):
    monkeypatch.setattr(Config, "GOOGLE_MAPS_API_KEY", "key")

    def fail(*a):
        raise maps.MapsError("Couldn't reach Google Maps")
    monkeypatch.setattr(maps, "_get", fail)
    monkeypatch.setattr(maps, "_post", fail)
    r = client.post("/api/routes/where", headers=AUTH, json=HERE)
    assert r.status_code == 502
