"""Minimal stdlib HTTP client with per-host pacing and polite retries."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import __version__

DEFAULT_USER_AGENT = f"sc-research/{__version__} (+https://github.com/ScalableCapital/scalable-cli)"


class HttpError(Exception):
    def __init__(self, url: str, status: int | None, message: str) -> None:
        super().__init__(f"{status or 'network'} {url}: {message}")
        self.url = url
        self.status = status
        self.message = message


class RateLimited(HttpError):
    pass


_lock = threading.Lock()
_next_slot: dict[str, float] = {}
# Minimum seconds between requests per host; published limits where they exist.
MIN_INTERVAL: dict[str, float] = {
    "api.gdeltproject.org": 5.5,  # "one every 5 seconds"
    "api.openfigi.com": 2.5,  # 25 requests / minute without an API key
    "data.sec.gov": 0.15,  # SEC fair access: max 10 requests / second
    "www.sec.gov": 0.15,
}


def _pace(host: str) -> None:
    interval = MIN_INTERVAL.get(host, 0.0)
    if interval <= 0:
        return
    with _lock:
        now = time.monotonic()
        slot = max(now, _next_slot.get(host, 0.0))
        _next_slot[host] = slot + interval
    delay = slot - time.monotonic()
    if delay > 0:
        time.sleep(delay)


def request(
    url: str,
    *,
    method: str = "GET",
    body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
    retries: int = 2,
) -> bytes:
    host = urllib.parse.urlsplit(url).hostname or ""
    data = json.dumps(body).encode() if body is not None else None
    merged = {"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/json, text/csv;q=0.9, */*;q=0.1"}
    if data is not None:
        merged["Content-Type"] = "application/json"
    merged.update(headers or {})

    attempt = 0
    while True:
        _pace(host)
        req = urllib.request.Request(url, data=data, method=method, headers=merged)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            text = exc.read()[:500].decode("utf-8", "replace")
            retryable = status == 429 or status >= 500
            if retryable and attempt < retries:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                wait = float(retry_after) if retry_after and retry_after.isdigit() else 2.0 * (attempt + 1)
                time.sleep(min(wait, 30.0))
                attempt += 1
                continue
            cls = RateLimited if status == 429 else HttpError
            raise cls(url, status, text) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt < retries:
                time.sleep(2.0 * (attempt + 1))
                attempt += 1
                continue
            raise HttpError(url, None, str(exc)) from exc


def get_json(url: str, **kwargs: Any) -> Any:
    raw = request(url, **kwargs)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HttpError(url, 200, f"not JSON: {raw[:200].decode('utf-8', 'replace')}") from exc


def get_text(url: str, **kwargs: Any) -> str:
    return request(url, **kwargs).decode("utf-8", "replace")
