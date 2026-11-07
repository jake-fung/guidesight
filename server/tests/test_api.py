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
    record = client.get(f"/api/walks/{wid}", headers=AUTH).get_json()
    assert record["walk"]["stop_count"] == 2 and record["walk"]["ended_at"]
    assert [e["type"] for e in record["events"]] == ["stop", "stop", "alert", "question"]


def test_settings_roundtrip(client):
    r = client.put("/api/settings", headers=AUTH, json={"speech_rate": 1.3, "bogus": 1})
    assert r.get_json()["speech_rate"] == 1.3 and "bogus" not in r.get_json()


def test_accessibility_settings(client):
    r = client.put("/api/settings", headers=AUTH,
                   json={"text_size": "extra_large", "high_contrast": True, "read_screen_aloud": True})
    s = r.get_json()
    assert s["text_size"] == "extra_large" and s["high_contrast"] is True and s["zoom"] is False


@pytest.mark.parametrize("bad", [
    {"text_size": "huge"},
    {"high_contrast": "yes"},
    {"speech_rate": 9},
    {"speech_rate": "fast"},
    {"alert_verbosity": "loud"},
])
def test_bad_settings_are_rejected(client, bad):
    r = client.put("/api/settings", headers=AUTH, json=bad)
    assert r.status_code == 400 and r.get_json()["error"]


def test_bad_harness_event(client):
    wid = client.post("/api/walks", headers=AUTH).get_json()["id"]
    r = client.post(f"/api/walks/{wid}/harness-event", headers=AUTH, json={"type": "jump"})
    assert r.status_code == 400


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
    events = client.get(f"/api/walks/{wid}", headers=AUTH).get_json()["events"]
    obstacles = [e for e in events if e["type"] == "obstacle"]
    assert len(obstacles) == 2 and obstacles[1]["motion"] == {"cm": 60}
