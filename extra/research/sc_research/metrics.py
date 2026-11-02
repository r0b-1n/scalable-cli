"""Technical metrics derived locally from `sc broker chart` price series."""

from __future__ import annotations

import datetime as dt
import math
from statistics import fmean, pstdev
from typing import Any


def _ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def series(chart: dict[str, Any]) -> list[tuple[dt.datetime, float]]:
    points = [
        (_ts(p["timestamp_utc"]), float(p["mid_price"]))
        for p in chart.get("data_points") or []
        if p.get("timestamp_utc") and p.get("mid_price") is not None
    ]
    points.sort()
    return points


def sma(prices: list[float], n: int) -> float | None:
    return fmean(prices[-n:]) if len(prices) >= n else None


def rsi(prices: list[float], n: int = 14) -> float | None:
    """Wilder's RSI over the last `n` periods' smoothing."""
    if len(prices) <= n:
        return None
    deltas = [b - a for a, b in zip(prices, prices[1:])]
    gain = fmean(max(d, 0) for d in deltas[:n])
    loss = fmean(max(-d, 0) for d in deltas[:n])
    for d in deltas[n:]:
        gain = (gain * (n - 1) + max(d, 0)) / n
        loss = (loss * (n - 1) + max(-d, 0)) / n
    if loss == 0:
        return 100.0
    return round(100 - 100 / (1 + gain / loss), 2)


def max_drawdown(points: list[tuple[dt.datetime, float]]) -> dict[str, Any] | None:
    if len(points) < 2:
        return None
    peak_t, peak = points[0]
    worst = (0.0, peak_t, points[0][0])
    for t, p in points:
        if p > peak:
            peak_t, peak = t, p
        dd = p / peak - 1
        if dd < worst[0]:
            worst = (dd, peak_t, t)
    return {"pct": round(worst[0] * 100, 2), "peak_at": worst[1].isoformat(), "trough_at": worst[2].isoformat()}


def summarize(chart: dict[str, Any]) -> dict[str, Any]:
    pts = series(chart)
    if len(pts) < 2:
        return {"points": len(pts), "insufficient_data": True}
    prices = [p for _, p in pts]
    first_t, first = pts[0]
    last_t, last = pts[-1]
    years = max((last_t - first_t).total_seconds() / (365.25 * 86400), 1e-9)
    log_returns = [math.log(b / a) for a, b in zip(prices, prices[1:]) if a > 0 and b > 0]
    periods_per_year = len(log_returns) / years
    hi, lo = max(prices), min(prices)
    out: dict[str, Any] = {
        "timeframe": chart.get("timeframe"),
        "currency": chart.get("currency"),
        "points": len(pts),
        "from": first_t.isoformat(),
        "to": last_t.isoformat(),
        "first": round(first, 4),
        "last": round(last, 4),
        "return_pct": round((last / first - 1) * 100, 2),
        "high": round(hi, 4),
        "low": round(lo, 4),
        "below_high_pct": round((last / hi - 1) * 100, 2),
        "above_low_pct": round((last / lo - 1) * 100, 2),
        "volatility_annualized_pct": round(pstdev(log_returns) * math.sqrt(periods_per_year) * 100, 2)
        if len(log_returns) > 2
        else None,
        "max_drawdown": max_drawdown(pts),
        "rsi_14": rsi(prices),
    }
    if years >= 1.5:
        out["cagr_pct"] = round(((last / first) ** (1 / years) - 1) * 100, 2)
    for n in (20, 50, 200):
        avg = sma(prices, n)
        if avg is not None:
            out[f"sma_{n}"] = round(avg, 4)
            out[f"vs_sma_{n}_pct"] = round((last / avg - 1) * 100, 2)
    return out
