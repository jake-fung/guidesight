"""Harness <-> server <-> phone live link (app/live.py)."""
import base64
import json
import threading

import pytest
import simple_websocket
from werkzeug.serving import make_server

from app import create_app

AUTH = {"Authorization": "Bearer test-token"}
JPEG = base64.b64encode(b"\xff\xd8\xff fake jpeg").decode()


class FakeHarness:
    def __init__(self):
        self.sent = []

    def send(self, data):
        self.sent.append(data)
        return True


@pytest.fixture
def app():
    return create_app(testing=True)


def test_status_and_buzz_when_harness_offline(app):
    client = app.test_client()
    client.put("/api/settings", headers=AUTH, json={"harness_id": "  gs-test  "})
    assert client.get("/api/harness/status", headers=AUTH).get_json() == {"harness_id": "gs-test", "online": False}
    assert client.post("/api/harness/buzz", headers=AUTH, json={"pattern": "double"}).get_json() == {"delivered": False}
    assert client.post("/api/harness/buzz", headers=AUTH, json={"pattern": "siren"}).status_code == 400


def test_frame_alert_buzzes_paired_harness(app):
    client = app.test_client()
    client.put("/api/settings", headers=AUTH, json={"harness_id": "gs-test"})
    harness = FakeHarness()
    app.extensions["hub"].add_harness("gs-test", harness)

    assert client.get("/api/harness/status", headers=AUTH).get_json()["online"] is True
    wid = client.post("/api/walks", headers=AUTH).get_json()["id"]
    client.post(f"/api/walks/{wid}/frame", headers=AUTH, json={"image": JPEG, "trigger": "obstacle"})
    assert harness.sent == ["double"]  # mock scene is medium urgency


@pytest.fixture
def live_server(app):
    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"ws://127.0.0.1:{server.server_port}"
    server.shutdown()


def receive_json(ws):
    data = ws.receive(timeout=5)
    assert data is not None, "timed out waiting for a message"
    return json.loads(data)


def test_events_and_buzz_over_websockets(app, live_server):
    client = app.test_client()
    client.put("/api/settings", headers=AUTH, json={"harness_id": "gs-test"})

    phone = simple_websocket.Client.connect(f"{live_server}/api/live")
    phone.send(json.dumps({"type": "auth", "token": "test-token"}))
    assert receive_json(phone) == {"type": "harness_status", "harness_id": "gs-test", "online": False}

    harness = simple_websocket.Client.connect(f"{live_server}/api/harness/ws")
    harness.send(json.dumps({"type": "hello", "id": "gs-test", "key": "anything"}))
    assert receive_json(phone)["online"] is True

    harness.send("ping")
    assert harness.receive(timeout=5) == "pong"
    harness.send(json.dumps({"type": "obstacle", "cm": 85}))
    assert receive_json(phone) == {"type": "harness_event", "event": {"type": "obstacle", "cm": 85.0}}

    assert client.post("/api/harness/buzz", headers=AUTH, json={"pattern": "long"}).get_json() == {"delivered": True}
    assert harness.receive(timeout=5) == "long"

    harness.close()
    assert receive_json(phone)["online"] is False
    phone.close()


def test_sockets_without_credentials_are_closed(live_server):
    phone = simple_websocket.Client.connect(f"{live_server}/api/live")
    phone.send(json.dumps({"type": "auth", "token": ""}))
    with pytest.raises(simple_websocket.ConnectionClosed):
        phone.receive(timeout=5)

    harness = simple_websocket.Client.connect(f"{live_server}/api/harness/ws")
    harness.send(json.dumps({"type": "hello", "key": "no id"}))
    with pytest.raises(simple_websocket.ConnectionClosed):
        harness.receive(timeout=5)
