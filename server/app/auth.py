"""Who is calling: each phone or browser makes a random device id on first open and sends it as
`Authorization: Bearer <device id>`. That id is the user id. There is no login.

Anyone who knows a device id can act as that device, so treat ids like passwords (they're random
and never shown in the app).
"""
import re
from functools import wraps

from flask import g, jsonify, request

# Long enough to be unguessable from the app (a UUID), short enough to be a Firestore document id.
_DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def verify_token(token: str) -> str | None:
    """The user id for a device id, or None if it isn't one."""
    return token if _DEVICE_ID.fullmatch(token or "") else None


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
