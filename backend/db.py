import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path("phototune.db")


def init_db():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT,
                image_id    TEXT,
                event_type  TEXT,
                payload     TEXT,
                ts          REAL
            )
        """)


def log_event(session_id: str, image_id: str | None, event_type: str, payload: dict):
    with _conn() as conn:
        conn.execute(
            "INSERT INTO events (session_id, image_id, event_type, payload, ts) VALUES (?,?,?,?,?)",
            (session_id, image_id, event_type, json.dumps(payload), time.time()),
        )


def _conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)
