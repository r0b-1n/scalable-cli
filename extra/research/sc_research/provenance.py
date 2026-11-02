"""Uniform section envelope: every piece of data says where and when it came from."""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from typing import Any

from .http import HttpError, RateLimited
from .sc import ScError


class Unavailable(Exception):
    """The source cannot answer for this input (not an error: e.g. no SEC filer)."""


def iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch, dt.UTC).isoformat(timespec="seconds")


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def section(source: str, produce: Callable[[], tuple[Any, float | None]], *, derived: bool = False) -> dict[str, Any]:
    """Run `produce` (returns (data, fetched_at_epoch|None)) and wrap the outcome.

    status: ok | unavailable | rate_limited | error. Errors never raise, so one
    failing source never hides the others from an agent.
    """
    base: dict[str, Any] = {"source": source}
    if derived:
        base["derived"] = True
    try:
        data, fetched_at = produce()
    except Unavailable as exc:
        return {**base, "status": "unavailable", "reason": str(exc)}
    except RateLimited as exc:
        return {**base, "status": "rate_limited", "error": exc.message[:300]}
    except ScError as exc:
        return {**base, "status": "error", "error": {"code": exc.code, "message": exc.message, "hints": exc.hints}}
    except HttpError as exc:
        return {**base, "status": "error", "error": {"http_status": exc.status, "message": exc.message[:300]}}
    except Exception as exc:  # noqa: BLE001 - surfaced to the agent, never swallowed silently
        return {**base, "status": "error", "error": {"type": type(exc).__name__, "message": str(exc)[:300]}}
    if data is None:
        return {**base, "status": "unavailable", "reason": "source returned no data"}
    return {**base, "status": "ok", "fetched_at": iso(fetched_at) if fetched_at else now_iso(), "data": data}
