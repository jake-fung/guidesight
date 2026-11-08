"""Device ids as user ids (app/auth.py)."""
import pytest

from app import create_app
from app.auth import verify_token


@pytest.mark.parametrize("token", ["test-token", "3f2b9c1e-8a4d-4f7e-9b1a-2c3d4e5f6a7b", "dev_ABCdef12"])
def test_device_ids_are_users(token):
    assert verify_token(token) == token


@pytest.mark.parametrize("token", ["", "short", "has space here", "a/b/c/d/e/f", "x" * 65, "../../etc"])
def test_rejects_non_ids(token):
    assert verify_token(token) is None


def test_each_device_is_its_own_user():
    client = create_app(testing=True).test_client()
    phone_a = {"Authorization": "Bearer device-aaaaaaaa"}
    phone_b = {"Authorization": "Bearer device-bbbbbbbb"}
    client.put("/api/me", headers=phone_a, json={"name": "Donna"})
    assert client.get("/api/me", headers=phone_a).get_json()["profile"]["name"] == "Donna"
    assert client.get("/api/me", headers=phone_b).get_json()["profile"]["name"] is None
    assert client.get("/api/me").status_code == 401
