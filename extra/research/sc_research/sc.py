"""Thin runner for the `sc` CLI's machine-readable mode."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any


class ScError(Exception):
    """An `sc` command failed. `code` is the CLI's machine error code when known."""

    def __init__(self, code: str, message: str, hints: list[str] | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.hints = hints or []


def _binary() -> str:
    configured = os.environ.get("SC_BIN")
    if configured:
        return configured
    found = shutil.which("sc")
    if not found:
        raise ScError("sc_not_found", "Scalable CLI `sc` not found on PATH; set SC_BIN.")
    return found


def run(args: list[str], *, timeout: float = 120.0) -> Any:
    """Run `sc <args> --json` and return the envelope's `data`.

    Raises ScError with the CLI's own error code, message and hints on failure.
    """
    try:
        proc = subprocess.run(
            [_binary(), *args, "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise ScError("sc_timeout", f"`sc {' '.join(args)}` timed out after {timeout}s") from exc

    stdout = proc.stdout.strip()
    try:
        envelope = json.loads(stdout) if stdout else None
    except json.JSONDecodeError:
        envelope = None

    if isinstance(envelope, dict):
        if envelope.get("ok"):
            return envelope.get("data")
        error = envelope.get("error") or {}
        raise ScError(
            str(error.get("code") or "sc_error"),
            str(error.get("message") or "unknown error"),
            [str(h) for h in envelope.get("hints") or []],
        )
    # No envelope: e.g. an invalid config.toml makes the CLI exit before JSON mode.
    detail = (proc.stderr or stdout or f"exit code {proc.returncode}").strip()
    raise ScError("sc_failed", detail[:2000])
