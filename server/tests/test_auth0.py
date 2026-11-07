"""Auth0 access-token checks (app/auth.py), with a throwaway RSA key standing in for the tenant's."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth
from app.config import Config

DOMAIN = "guidesight-test.us.auth0.com"
AUDIENCE = "https://api.guidesight.test"

TENANT_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeSigningKeys:
    """Stands in for the JWKS endpoint: always returns the tenant's public key."""

    def get_signing_key_from_jwt(self, token):
        return type("Key", (), {"key": TENANT_KEY.public_key()})()


@pytest.fixture(autouse=True)
def auth0_tenant(monkeypatch):
    monkeypatch.setattr(Config, "AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setattr(Config, "AUTH0_AUDIENCE", AUDIENCE)
    monkeypatch.setattr(auth, "_jwks", FakeSigningKeys())


def token(key=TENANT_KEY, **overrides):
    claims = {
        "sub": "auth0|walker1",
        "aud": AUDIENCE,
        "iss": f"https://{DOMAIN}/",
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
        **overrides,
    }
    return jwt.encode(claims, key, algorithm="RS256")


def test_valid_token_gives_user_id():
    assert auth.verify_auth0_token(token()) == "auth0|walker1"


@pytest.mark.parametrize("bad", [
    lambda: token(aud="https://some-other-api"),
    lambda: token(iss="https://evil.example.com/"),
    lambda: token(exp=int(time.time()) - 60),
    lambda: token(key=OTHER_KEY),
    lambda: "not-a-jwt",
])
def test_bad_tokens_are_rejected(bad):
    assert auth.verify_auth0_token(bad()) is None


def test_harness_needs_key_once_auth0_is_on(monkeypatch):
    from app.live import _harness_key_ok

    monkeypatch.setattr(Config, "HARNESS_KEY", "")
    assert _harness_key_ok("anything") is False
    monkeypatch.setattr(Config, "HARNESS_KEY", "s3cret")
    assert _harness_key_ok("s3cret") is True and _harness_key_ok("wrong") is False
