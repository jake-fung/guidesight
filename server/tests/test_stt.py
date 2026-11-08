import io

import pytest

from app import create_app
from app.config import Config
from app.services import stt

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client():
    return create_app(testing=True).test_client()


def clip(data=b"fake-audio"):
    return {"audio": (io.BytesIO(data), "phrase.m4a")}


def test_stt_off_without_key(client):
    r = client.post("/api/stt", headers=AUTH, data=clip(), content_type="multipart/form-data")
    assert r.status_code == 503


def test_stt_returns_transcript(client, monkeypatch):
    calls = []
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")
    monkeypatch.setattr(stt, "transcribe", lambda audio: calls.append(audio) or "I'm blind.")

    r = client.post("/api/stt", headers=AUTH, data=clip(b"abc"), content_type="multipart/form-data")
    assert r.status_code == 200 and r.get_json() == {"transcript": "I'm blind."}
    assert calls == [b"abc"]


def test_stt_validates(client, monkeypatch):
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")
    assert client.post("/api/stt", headers=AUTH, data={}, content_type="multipart/form-data").status_code == 400
    assert client.post("/api/stt", data=clip(), content_type="multipart/form-data").status_code == 401


def test_stt_upstream_error(client, monkeypatch):
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")

    def boom(audio):
        raise RuntimeError("down")

    monkeypatch.setattr(stt, "transcribe", boom)
    r = client.post("/api/stt", headers=AUTH, data=clip(), content_type="multipart/form-data")
    assert r.status_code == 502


def test_realtime_token_off_without_key(client):
    assert client.post("/api/stt/token", headers=AUTH).status_code == 503


def test_realtime_token(client, monkeypatch):
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")
    monkeypatch.setattr(stt, "realtime_token", lambda: "sutkn_abc")
    r = client.post("/api/stt/token", headers=AUTH)
    assert r.status_code == 200
    assert r.get_json() == {"token": "sutkn_abc", "model_id": Config.ELEVENLABS_REALTIME_STT_MODEL}
    assert client.post("/api/stt/token").status_code == 401


def test_realtime_token_upstream_error(client, monkeypatch):
    monkeypatch.setattr(Config, "ELEVENLABS_API_KEY", "key")

    def boom():
        raise OSError("down")

    monkeypatch.setattr(stt, "realtime_token", boom)
    assert client.post("/api/stt/token", headers=AUTH).status_code == 502
