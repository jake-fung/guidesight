"""Live link between the harness and the walker web app.

Both keep a WebSocket open to the server. The first message on each socket authenticates it:
    harness -> server:  {"type": "hello", "id": "<harness id>", "key": "<HARNESS_KEY>"}
    phone   -> server:  {"type": "auth", "token": "<Auth0 access token>"}

After that:
    harness -> server:  {"type": "obstacle", "cm": 85}  (or "stop"/"pull" with "accel"), or "ping"
    server  -> harness: "short" | "double" | "long" (buzz pattern), or "pong" (heartbeat reply,
                        so the harness can tell a dead connection from a quiet one)
    server  -> phone:   {"type": "harness_event", "event": {"type": ..., "cm"/"accel": ...}}
                        {"type": "harness_status", "harness_id": "...", "online": true|false}
    phone   -> server:  "ping" (keeps tunnels and proxies from closing an idle socket)

A harness belongs to whichever user saved its id as settings.harness_id (paired on the Setup screen).
Connections live in this process's memory, so run a single server process.
"""
import hmac
import json
import logging
import threading

from flask import Flask, current_app, request
from flask_sock import Sock
from simple_websocket import ConnectionClosed

from .auth import verify_token
from .config import Config
from .store import get_store

PATTERNS = ("short", "double", "long")
HARNESS_EVENT_TYPES = ("stop", "pull", "obstacle")
AUTH_TIMEOUT_S = 10
HARNESS_TIMEOUT_S = 45  # the harness sends "ping" every 15 s; drop it after 3 missed beats

log = logging.getLogger(__name__)


class Connection:
    """A WebSocket that several request threads may send on."""

    def __init__(self, ws, ip: str | None = None):
        self.ws = ws
        self.ip = ip  # where it connected from, to find sensors on the same network as the phone
        self._lock = threading.Lock()

    def send(self, data: str) -> bool:
        try:
            with self._lock:
                self.ws.send(data)
            return True
        except Exception:  # closed or broken
            return False

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


class Hub:
    def __init__(self):
        self._lock = threading.Lock()
        self._harnesses: dict[str, Connection] = {}
        self._phones: dict[str, set[Connection]] = {}  # uid -> open walker app tabs

    # ---- Harnesses ----------------------------------------------------------
    def add_harness(self, harness_id: str, conn: Connection) -> Connection | None:
        """Registers the harness and returns the connection it replaced, if any."""
        with self._lock:
            old = self._harnesses.get(harness_id)
            self._harnesses[harness_id] = conn
        return old

    def remove_harness(self, harness_id: str, conn: Connection) -> bool:
        """False if a newer connection from the same harness has already replaced this one."""
        with self._lock:
            if self._harnesses.get(harness_id) is not conn:
                return False
            del self._harnesses[harness_id]
            return True

    def is_online(self, harness_id: str | None) -> bool:
        return bool(harness_id) and harness_id in self._harnesses

    def online_harnesses(self) -> dict[str, str | None]:
        """harness id -> the IP address it connected from."""
        with self._lock:
            return {hid: getattr(conn, "ip", None) for hid, conn in self._harnesses.items()}

    def buzz(self, harness_id: str | None, pattern: str) -> bool:
        conn = self._harnesses.get(harness_id) if harness_id else None
        return conn is not None and conn.send(pattern)

    # ---- Phones -------------------------------------------------------------
    def add_phone(self, uid: str, conn: Connection):
        with self._lock:
            self._phones.setdefault(uid, set()).add(conn)

    def remove_phone(self, uid: str, conn: Connection):
        with self._lock:
            self._phones.get(uid, set()).discard(conn)

    def send_to_user(self, uid: str, message: dict):
        with self._lock:
            conns = list(self._phones.get(uid, ()))
        data = json.dumps(message)
        for conn in conns:
            conn.send(data)


def get_hub() -> Hub:
    return current_app.extensions["hub"]


def client_ip() -> str | None:
    """The caller's public IP. Behind Cloudflare Tunnel or a proxy the socket address is the proxy's,
    so the forwarded header wins. Headers can be faked: only use this as a hint, never for access."""
    forwarded = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() or request.remote_addr


def notify_harness_status(uid: str, harness_id: str | None):
    """Tells the user's open app tabs whether their harness is connected."""
    get_hub().send_to_user(uid, _status(harness_id, get_hub().is_online(harness_id)))


def buzz_user_harness(uid: str, pattern: str | None, settings: dict | None = None) -> bool:
    """Vibrates the harness paired with this user. False if it isn't connected."""
    if pattern not in PATTERNS:
        return False
    settings = settings or get_store().get_settings(uid)
    return get_hub().buzz(settings.get("harness_id"), pattern)


def _status(harness_id: str | None, online: bool) -> dict:
    return {"type": "harness_status", "harness_id": harness_id, "online": online}


def _harness_key_ok(key: str) -> bool:
    if Config.HARNESS_KEY:
        return hmac.compare_digest(key.encode(), Config.HARNESS_KEY.encode())
    # No key configured: fine in mock mode, refused once real logins are on.
    return not Config.auth_enabled()


def _first_message(ws) -> dict:
    try:
        msg = json.loads(ws.receive(timeout=AUTH_TIMEOUT_S) or "")
        return msg if isinstance(msg, dict) else {}
    except (ValueError, TypeError):
        return {}


def _parse_event(data: str) -> dict | None:
    try:
        msg = json.loads(data)
        if msg.get("type") not in HARNESS_EVENT_TYPES:
            return None
        event = {"type": msg["type"]}
        for key in ("cm", "accel", "ms"):  # cm: ultrasonic distance, accel: motion sensor
            if key in msg:
                event[key] = float(msg[key])
        return event
    except (ValueError, TypeError, AttributeError):
        return None


def _notify_owner(harness_id: str, message: dict):
    owner = get_store().find_harness_owner(harness_id)
    if owner:
        get_hub().send_to_user(owner, message)


def init_live(app: Flask):
    app.extensions["hub"] = Hub()
    sock = Sock(app)

    @sock.route("/api/harness/ws")
    def harness_socket(ws):
        hello = _first_message(ws)
        harness_id = str(hello.get("id", "")).strip()
        if hello.get("type") != "hello" or not harness_id or not _harness_key_ok(str(hello.get("key", ""))):
            ws.close(reason=1008, message="unauthorized")
            return

        hub, conn = get_hub(), Connection(ws, client_ip())
        replaced = hub.add_harness(harness_id, conn)
        if replaced:
            replaced.close()
        log.info("harness %s connected", harness_id)
        _notify_owner(harness_id, _status(harness_id, True))

        try:
            while True:
                data = ws.receive(timeout=HARNESS_TIMEOUT_S)
                if data is None:
                    log.info("harness %s missed its heartbeats", harness_id)
                    break
                if data == "ping":
                    conn.send("pong")
                    continue
                event = _parse_event(data)
                if event is None:
                    log.warning("harness %s sent an unknown message: %.100r", harness_id, data)
                    continue
                _notify_owner(harness_id, {"type": "harness_event", "event": event})
        except ConnectionClosed:
            pass
        finally:
            if hub.remove_harness(harness_id, conn):
                log.info("harness %s disconnected", harness_id)
                _notify_owner(harness_id, _status(harness_id, False))

    @sock.route("/api/live")
    def phone_socket(ws):
        auth = _first_message(ws)
        uid = verify_token(str(auth.get("token", ""))) if auth.get("type") == "auth" else None
        if not uid:
            ws.close(reason=1008, message="unauthorized")
            return

        hub, conn = get_hub(), Connection(ws)
        hub.add_phone(uid, conn)
        harness_id = get_store().get_settings(uid).get("harness_id")
        conn.send(json.dumps(_status(harness_id, hub.is_online(harness_id))))
        try:
            while True:
                ws.receive()  # only heartbeats arrive here
        except ConnectionClosed:
            pass
        finally:
            hub.remove_phone(uid, conn)
