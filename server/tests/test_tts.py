import pytest

from app import create_app
from app.config import Config
from app.services import tts

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client():
    return create_app(testing=True).test_client()


def test_tts_off_without_key(client):
    r = client.post("/api/tts", headers=AUTH, json={"text": "Curb ahead"})
    assert r.status_code == 503


def test_tts_returns_audio(client, monkeypatch):
    calls = []
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")
    monkeypatch.setattr(tts, "synthesize", lambda text, speed, voice: calls.append((text, speed, voice)) or b"ID3mp3")

    r = client.post("/api/tts", headers=AUTH, json={"text": "Curb ahead", "speed": 1.1})
    assert r.status_code == 200 and r.mimetype == "audio/mpeg" and r.data == b"ID3mp3"
    assert calls == [("Curb ahead", 1.1, None)]  # "default" voice -> server's voice

    client.put("/api/settings", headers=AUTH, json={"voice": "abc123"})
    client.post("/api/tts", headers=AUTH, json={"text": "Hi"})
    assert calls[-1] == ("Hi", 1.0, "abc123")


def test_tts_validates(client, monkeypatch):
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")
    assert client.post("/api/tts", headers=AUTH, json={"text": "  "}).status_code == 400
    assert client.post("/api/tts", headers=AUTH, json={"text": "Hi", "speed": "fast"}).status_code == 400
    assert client.post("/api/tts", json={"text": "Hi"}).status_code == 401
