"""Storage for walk logs. Firestore in production, an in-memory dict in mock mode.

Firestore layout:
    users/{uid}                                  -> {settings: {...}}
    users/{uid}/walks/{walkId}                   -> {started_at, ended_at, stop_count, pull_count}
    users/{uid}/walks/{walkId}/events/{eventId}  -> {type, at, location, motion, text}
"""
import uuid
from datetime import datetime, timezone

from flask import Flask, current_app

from .config import Config

DEFAULT_SETTINGS = {
    "voice": "default",
    "speech_rate": 1.0,
    "alert_verbosity": "short",  # short | detailed
    "haptics_enabled": True,
    "harness_id": None,
    "auto_describe_on_stop": True,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryStore:
    def __init__(self):
        self.settings: dict[str, dict] = {}
        self.walks: dict[str, dict[str, dict]] = {}  # uid -> walk_id -> walk
        self.events: dict[str, list[dict]] = {}  # walk_id -> events

    def get_settings(self, uid):
        return {**DEFAULT_SETTINGS, **self.settings.get(uid, {})}

    def save_settings(self, uid, data):
        self.settings[uid] = {**self.get_settings(uid), **data}
        return self.settings[uid]

    def create_walk(self, uid):
        walk = {"id": uuid.uuid4().hex, "started_at": now_iso(), "ended_at": None,
                "stop_count": 0, "pull_count": 0}
        self.walks.setdefault(uid, {})[walk["id"]] = walk
        self.events[walk["id"]] = []
        return walk

    def get_walk(self, uid, walk_id):
        return self.walks.get(uid, {}).get(walk_id)

    def end_walk(self, uid, walk_id):
        walk = self.get_walk(uid, walk_id)
        if walk:
            walk["ended_at"] = now_iso()
        return walk

    def add_event(self, uid, walk_id, event):
        walk = self.get_walk(uid, walk_id)
        if walk is None:
            return None
        event = {"id": uuid.uuid4().hex, "walk_id": walk_id, "at": now_iso(), **event}
        self.events[walk_id].append(event)
        if event["type"] in ("stop", "pull"):
            walk[f"{event['type']}_count"] += 1
        return event

    def list_walks(self, uid, limit=20):
        walks = sorted(self.walks.get(uid, {}).values(), key=lambda w: w["started_at"], reverse=True)
        return walks[:limit]

    def list_events(self, uid, walk_id):
        return list(self.events.get(walk_id, [])) if self.get_walk(uid, walk_id) else []


class FirestoreStore:
    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(Config.FIREBASE_CREDENTIALS))
        self.db = firestore.client()
        self._increment = firestore.Increment

    def _user(self, uid):
        return self.db.collection("users").document(uid)

    def _walk(self, uid, walk_id):
        return self._user(uid).collection("walks").document(walk_id)

    def get_settings(self, uid):
        snap = self._user(uid).get()
        return {**DEFAULT_SETTINGS, **((snap.to_dict() or {}).get("settings", {}) if snap.exists else {})}

    def save_settings(self, uid, data):
        merged = {**self.get_settings(uid), **data}
        self._user(uid).set({"settings": merged}, merge=True)
        return merged

    def create_walk(self, uid):
        ref = self._user(uid).collection("walks").document()
        walk = {"started_at": now_iso(), "ended_at": None, "stop_count": 0, "pull_count": 0}
        ref.set(walk)
        return {"id": ref.id, **walk}

    def get_walk(self, uid, walk_id):
        snap = self._walk(uid, walk_id).get()
        return {"id": snap.id, **snap.to_dict()} if snap.exists else None

    def end_walk(self, uid, walk_id):
        if not self.get_walk(uid, walk_id):
            return None
        self._walk(uid, walk_id).update({"ended_at": now_iso()})
        return self.get_walk(uid, walk_id)

    def add_event(self, uid, walk_id, event):
        walk_ref = self._walk(uid, walk_id)
        if not walk_ref.get().exists:
            return None
        ref = walk_ref.collection("events").document()
        event = {"walk_id": walk_id, "at": now_iso(), **event}
        ref.set(event)
        if event["type"] in ("stop", "pull"):
            walk_ref.update({f"{event['type']}_count": self._increment(1)})
        return {"id": ref.id, **event}

    def list_walks(self, uid, limit=20):
        from firebase_admin import firestore

        q = (self._user(uid).collection("walks")
             .order_by("started_at", direction=firestore.Query.DESCENDING).limit(limit))
        return [{"id": s.id, **s.to_dict()} for s in q.stream()]

    def list_events(self, uid, walk_id):
        q = self._walk(uid, walk_id).collection("events").order_by("at")
        return [{"id": s.id, **s.to_dict()} for s in q.stream()]


def init_store(app: Flask, force_memory: bool = False):
    use_firestore = Config.firebase_enabled() and not force_memory
    app.extensions["store"] = FirestoreStore() if use_firestore else MemoryStore()


def get_store() -> MemoryStore | FirestoreStore:
    return current_app.extensions["store"]
