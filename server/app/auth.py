"""Verifies the Auth0 access token the web app sends as `Authorization: Bearer <token>`.

The token is a JWT signed by the Auth0 tenant (RS256) for this API's audience. The user id
is its `sub` claim, for example "auth0|65f0c...".
"""
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from .config import Config

DEV_UID = "dev-user"

_jwks: jwt.PyJWKClient | None = None


def _signing_keys() -> jwt.PyJWKClient:
    global _jwks
    if _jwks is None:
        # Caches the tenant's public keys and refetches them when Auth0 rotates keys.
        _jwks = jwt.PyJWKClient(f"https://{Config.AUTH0_DOMAIN}/.well-known/jwks.json", cache_keys=True)
    return _jwks


def verify_auth0_token(token: str) -> str | None:
    try:
        key = _signing_keys().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=Config.AUTH0_AUDIENCE,
            issuer=f"https://{Config.AUTH0_DOMAIN}/",
        )
        return claims["sub"]
    except (jwt.PyJWTError, KeyError):  # invalid, expired, wrong tenant or audience
        return None


def verify_token(token: str) -> str | None:
    if current_app.config.get("TESTING") or not Config.auth_enabled():
        # Mock mode: accept any token so the app works before Auth0 is set up.
        return DEV_UID if token else None
    return verify_auth0_token(token)


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header.removeprefix("Bearer ").strip()
        uid = verify_token(token)
        if not uid:
            return jsonify(error="unauthorized"), 401
        g.uid = uid
        return fn(*args, **kwargs)

    return wrapper
