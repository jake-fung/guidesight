"""Storage for users and walk logs. Firestore in production, an in-memory dict in mock mode.

Firestore layout:
    users/{uid}                                  -> {profile: {...}, setup: {...}, settings: {...}}
    users/{uid}/walks/{walkId}                   -> {started_at, ended_at, stop_count, pull_count}
    users/{uid}/walks/{walkId}/events/{eventId}  -> {type, at, location, motion, text}
"""
import uuid
from datetime import datetime, timezone

from flask import Flask, current_app

from .config import Config

DEFAULT_PROFILE = {
    "name": None,  # what Sighty calls the user (Register step 1)
    "email": None,  # shown in Settings; sent by the app from setup
}

# First-run Setup screens. Each step is "pending" until the user answers it.
DEFAULT_SETUP = {
    "camera": "pending",  # pending | allowed | skipped
    "microphone": "pending",  # pending | allowed | skipped
    "sensor": "pending",  # pending | connected | skipped
    "completed_at": None,
}

DEFAULT_SETTINGS = {
    "voice": "default",
    "speech_rate": 1.0,
    "alert_verbosity": "short",  # short | detailed
    "haptics_enabled": True,  # "Vibration alerts"
    "harness_id": None,
    "auto_describe_on_stop": True,
    # Accessibility (Settings screen and the accessibility shortcut)
    "text_size": "default",  # default | large | extra_large
    "high_contrast": False,
    "read_screen_aloud": False,
    "zoom": False,
    "voice_control": False,
}

SECTION_DEFAULTS = {"profile": DEFAULT_PROFILE, "setup": DEFAULT_SETUP, "settings": DEFAULT_SETTINGS}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _SectionHelpers:
    """Shortcuts shared by both stores, built on get_user / save_section."""

    def get_settings(self, uid):
        return self.get_user(uid)["settings"]

    def save_settings(self, uid, data):
        return self.save_section(uid, "settings", data)

    def harness_taken(self, uid, harness_id):
        """True if another user has already paired this harness."""
        owner = self.find_harness_owner(harness_id) if harness_id else None
        return owner is not None and owner != uid


class MemoryStore(_SectionHelpers):
    def __init__(self):
        self.users: dict[str, dict[str, dict]] = {}  # uid -> {profile, setup, settings}
        self.walks: dict[str, dict[str, dict]] = {}  # uid -> walk_id -> walk
        self.events: dict[str, list[dict]] = {}  # walk_id -> events

    def get_user(self, uid):
        doc = self.users.get(uid, {})
        return {name: {**defaults, **doc.get(name, {})} for name, defaults in SECTION_DEFAULTS.items()}

    def save_section(self, uid, section, data):
        merged = {**self.get_user(uid)[section], **data}
        self.users.setdefault(uid, {})[section] = merged
        return merged

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

    def list_events(self, uid, walk_id):
        return list(self.events.get(walk_id, [])) if self.get_walk(uid, walk_id) else []

    def find_harness_owner(self, harness_id):
        return next((uid for uid, doc in self.users.items()
                     if doc.get("settings", {}).get("harness_id") == harness_id), None)


class FirestoreStore(_SectionHelpers):
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

    def get_user(self, uid):
        snap = self._user(uid).get()
        doc = (snap.to_dict() or {}) if snap.exists else {}
        return {name: {**defaults, **doc.get(name, {})} for name, defaults in SECTION_DEFAULTS.items()}

    def save_section(self, uid, section, data):
        merged = {**self.get_user(uid)[section], **data}
        self._user(uid).set({section: merged}, merge=True)
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

    def list_events(self, uid, walk_id):
        q = self._walk(uid, walk_id).collection("events").order_by("at")
        return [{"id": s.id, **s.to_dict()} for s in q.stream()]

    def find_harness_owner(self, harness_id):
        from google.cloud.firestore_v1 import FieldFilter

        q = self.db.collection("users").where(filter=FieldFilter("settings.harness_id", "==", harness_id)).limit(1)
        return next((s.id for s in q.stream()), None)


def init_store(app: Flask, force_memory: bool = False):
    use_firestore = Config.firestore_enabled() and not force_memory
    app.extensions["store"] = FirestoreStore() if use_firestore else MemoryStore()


def get_store() -> MemoryStore | FirestoreStore:
    return current_app.extensions["store"]
