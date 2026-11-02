"""SQLite TTL cache so repeated agent calls stay fast and inside rate limits."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")

_lock = threading.Lock()


def _default_dir() -> Path:
    configured = os.environ.get("SC_RESEARCH_CACHE_DIR")
    if configured:
        return Path(configured)
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "sc-research"


class Cache:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (_default_dir() / "cache.sqlite3")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, fetched_at REAL NOT NULL, value TEXT NOT NULL)"
            )
            # Nothing here lives longer than 30 days (FIGI mappings).
            db.execute("DELETE FROM entries WHERE fetched_at < ?", (time.time() - 31 * 24 * 3600,))

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        # sqlite3's own context manager commits but never closes the connection.
        db = sqlite3.connect(self.path, timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, key: str, ttl: float) -> tuple[Any, float] | None:
        with _lock, self._connect() as db:
            row = db.execute("SELECT fetched_at, value FROM entries WHERE key = ?", (key,)).fetchone()
        if row is None or time.time() - row[0] > ttl:
            return None
        return json.loads(row[1]), row[0]

    def put(self, key: str, value: Any) -> float:
        now = time.time()
        with _lock, self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO entries (key, fetched_at, value) VALUES (?, ?, ?)",
                (key, now, json.dumps(value)),
            )
        return now

    def fetch(self, key: str, ttl: float, produce: Callable[[], T]) -> tuple[T, float]:
        """Return (value, fetched_at epoch seconds), producing and storing on a miss."""
        hit = self.get(key, ttl)
        if hit is not None:
            return hit
        value = produce()
        return value, self.put(key, value)


class NullCache(Cache):
    """No-op cache for tests and `--no-cache`."""

    def __init__(self) -> None:  # noqa: D107 - nothing to set up
        pass

    def get(self, key: str, ttl: float) -> None:
        return None

    def put(self, key: str, value: Any) -> float:
        return time.time()
