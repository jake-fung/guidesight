import base64
import io

import pytest

from app import create_app

AUTH = {"Authorization": "Bearer test-token"}
JPEG = base64.b64encode(b"\xff\xd8\xff fake jpeg").decode()


@pytest.fixture
def client():
    return create_app(testing=True).test_client()


def test_requires_auth(client):
    assert client.post("/api/walks").status_code == 401


def test_full_walk_flow(client):
    walk = client.post("/api/walks", headers=AUTH).get_json()
    wid = walk["id"]
    loc = {"lat": 43.6532, "lng": -79.3832}

    r = client.post(f"/api/walks/{wid}/harness-event", headers=AUTH,
                    json={"type": "stop", "motion": {"accel": 0.1}, "location": loc})
    assert r.status_code == 201 and r.get_json()["capture_frame"] is True
    client.post(f"/api/walks/{wid}/harness-event", headers=AUTH, json={"type": "stop", "location": loc})

    r = client.post(f"/api/walks/{wid}/frame", headers=AUTH,
                    json={"image": JPEG, "trigger": "stop", "location": loc})
    alert = r.get_json()["alert"]
    assert alert["speak"] and alert["haptic"] == "double"

    r = client.post(f"/api/walks/{wid}/voice", headers=AUTH,
                    data={"audio": (io.BytesIO(b"wav"), "q.m4a"), "lat": "43.6", "lng": "-79.3"},
                    content_type="multipart/form-data")
    assert r.get_json()["transcript"] == "Which bus is this?"

    client.post(f"/api/walks/{wid}/end", headers=AUTH)
    summary = client.get("/api/dashboard/summary", headers=AUTH).get_json()
    assert summary["walks"][0]["stops"] == 2
    assert len(summary["stops"]) == 2
    assert summary["hotspots"][0]["count"] == 2


def test_settings_roundtrip(client):
    r = client.put("/api/settings", headers=AUTH, json={"speech_rate": 1.3, "bogus": 1})
    assert r.get_json()["speech_rate"] == 1.3 and "bogus" not in r.get_json()


def test_bad_harness_event(client):
    wid = client.post("/api/walks", headers=AUTH).get_json()["id"]
    r = client.post(f"/api/walks/{wid}/harness-event", headers=AUTH, json={"type": "jump"})
    assert r.status_code == 400


def test_dev_seed_feeds_dashboard(client):
    client.post("/api/dev/seed", headers=AUTH)
    summary = client.get("/api/dashboard/summary", headers=AUTH).get_json()
    assert len(summary["walks"]) == 5 and summary["stops"] and summary["hotspots"]


def test_obstacle_event_from_ultrasonic_harness(client):
    wid = client.post("/api/walks", headers=AUTH).get_json()["id"]
    r = client.post(f"/api/walks/{wid}/harness-event", headers=AUTH,
                    json={"type": "obstacle", "motion": {"cm": 85}})
    assert r.status_code == 201 and r.get_json()["capture_frame"] is True

    r = client.post(f"/api/walks/{wid}/frame", headers=AUTH,
                    json={"image": JPEG, "trigger": "obstacle"})
    assert r.get_json()["alert"]["speak"]

    client.post(f"/api/walks/{wid}/harness-event", headers=AUTH,
                json={"type": "obstacle", "motion": {"cm": 60}, "location": {"lat": 43.65, "lng": -79.38}})
    summary = client.get("/api/dashboard/summary", headers=AUTH).get_json()
    assert summary["walks"][0]["obstacles"] == 2
    assert summary["stops"][0]["type"] == "obstacle"
