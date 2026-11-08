"""Profile and first-run Setup after sign-up (routes/me.py, routes/setup.py)."""
import pytest

from app import create_app

AUTH = {"Authorization": "Bearer test-token"}  # the device id "test-token" is the user
OTHER_USER = "someone-else"


class FakeHarness:
    def __init__(self, ip=None):
        self.sent = []
        self.ip = ip

    def send(self, data):
        self.sent.append(data)
        return True


@pytest.fixture
def app():
    return create_app(testing=True)


@pytest.fixture
def client(app):
    return app.test_client()


def me(client):
    return client.get("/api/me", headers=AUTH).get_json()


def test_new_user_starts_with_name(client):
    data = me(client)
    assert data["next_step"] == "name"
    assert data["profile"] == {"name": None, "email": None}
    assert data["setup"] == {"camera": "pending", "microphone": "pending", "sensor": "pending",
                             "completed_at": None}
    assert data["settings"]["text_size"] == "default"


def test_full_setup_flow(client):
    r = client.put("/api/me", headers=AUTH, json={"name": "  Donna   Li ", "email": "donna@ubc.ca"})
    assert r.get_json()["profile"] == {"name": "Donna Li", "email": "donna@ubc.ca"}
    assert r.get_json()["next_step"] == "camera"

    assert client.put("/api/setup/camera", headers=AUTH, json={"status": "allowed"}).get_json()["next_step"] == "microphone"
    assert client.put("/api/setup/microphone", headers=AUTH, json={"status": "skipped"}).get_json()["next_step"] == "sensor"
    assert client.put("/api/setup/sensor", headers=AUTH, json={"status": "skipped"}).get_json()["next_step"] == "finish"

    done = client.post("/api/setup/complete", headers=AUTH).get_json()
    assert done["next_step"] is None and done["setup"]["completed_at"]
    assert done["setup"]["microphone"] == "skipped"


def test_complete_skips_pending_steps_and_needs_a_name(client):
    assert client.post("/api/setup/complete", headers=AUTH).status_code == 400
    client.put("/api/me", headers=AUTH, json={"name": "Donna"})
    done = client.post("/api/setup/complete", headers=AUTH).get_json()
    assert done["setup"]["camera"] == "skipped" and done["next_step"] is None


@pytest.mark.parametrize("path, body, code", [
    ("/api/setup/camera", {"status": "maybe"}, 400),
    ("/api/setup/sensor", {"status": "connected"}, 400),  # only pairing connects a sensor
    ("/api/setup/bluetooth", {"status": "allowed"}, 404),
])
def test_bad_setup_answers(client, path, body, code):
    assert client.put(path, headers=AUTH, json=body).status_code == code


@pytest.mark.parametrize("body", [{"name": "   "}, {"name": "x" * 61}, {"email": "not-an-email"}])
def test_bad_profile(client, body):
    assert client.put("/api/me", headers=AUTH, json=body).status_code == 400


def test_setup_needs_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.put("/api/setup/camera", json={"status": "allowed"}).status_code == 401


def test_sensor_search_and_pair(app, client):
    hub = app.extensions["hub"]
    near, far = FakeHarness(ip="203.0.113.7"), FakeHarness(ip="198.51.100.1")
    hub.add_harness("gs-near", near)
    hub.add_harness("gs-far", far)
    hub.add_harness("gs-taken", FakeHarness())
    app.extensions["store"].save_settings(OTHER_USER, {"harness_id": "gs-taken"})

    found = client.get("/api/setup/sensor", headers={**AUTH, "X-Forwarded-For": "203.0.113.7, 10.0.0.1"}).get_json()
    assert found["harness_id"] is None and found["online"] is False
    assert found["nearby"] == [{"id": "gs-near", "same_network": True}, {"id": "gs-far", "same_network": False}]

    r = client.post("/api/setup/sensor", headers=AUTH, json={"harness_id": "gs-near"}).get_json()
    assert r["harness_id"] == "gs-near" and r["buzzed"] is True and near.sent == ["double"]
    assert r["me"]["setup"]["sensor"] == "connected"
    assert r["me"]["settings"]["harness_id"] == "gs-near"

    found = client.get("/api/setup/sensor", headers=AUTH).get_json()
    assert found["online"] is True and [h["id"] for h in found["nearby"]] == ["gs-far"]


def test_cannot_pair_someone_elses_or_offline_sensor(app, client):
    app.extensions["hub"].add_harness("gs-taken", FakeHarness())
    app.extensions["store"].save_settings(OTHER_USER, {"harness_id": "gs-taken"})

    assert client.post("/api/setup/sensor", headers=AUTH, json={"harness_id": "gs-taken"}).status_code == 409
    assert client.put("/api/settings", headers=AUTH, json={"harness_id": "gs-taken"}).status_code == 409
    assert client.post("/api/setup/sensor", headers=AUTH, json={"harness_id": "gs-off"}).status_code == 404
    assert client.post("/api/setup/sensor", headers=AUTH, json={}).status_code == 400
