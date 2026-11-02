"""Technical metrics derived locally from `sc broker chart` price series.

Chart series are not evenly spaced (a 1y series can have a point every ~3 days,
`max` is weekly), so everything time-based is computed over calendar time:
moving averages over the last N calendar days, volatility from realised
variance per year. Sample-based indicators say so in their name and come with
the median sampling interval.
"""

from __future__ import annotations

import datetime as dt
import math
from statistics import fmean, median
from typing import Any


def _ts(s: str) -> dt.datetime:
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=dt.UTC)


def series(chart: dict[str, Any]) -> list[tuple[dt.datetime, float]]:
    """Sorted (time, price) points; non-positive or missing prices are dropped."""
    points = []
    for p in chart.get("data_points") or []:
        price = p.get("mid_price")
        if p.get("timestamp_utc") and price is not None and float(price) > 0:
            points.append((_ts(p["timestamp_utc"]), float(price)))
    points.sort()
    return points


def sma_days(points: list[tuple[dt.datetime, float]], days: int) -> float | None:
    """Mean price over the last `days` calendar days; None if the series is shorter."""
    if not points or (points[-1][0] - points[0][0]).days < days:
        return None
    cutoff = points[-1][0] - dt.timedelta(days=days)
    return fmean(p for t, p in points if t >= cutoff)


def rsi(prices: list[float], n: int = 14) -> float | None:
    """Wilder's RSI over `n` samples. A series with no movement is neutral (50)."""
    if len(prices) <= n:
        return None
    deltas = [b - a for a, b in zip(prices, prices[1:])]
    gain = fmean(max(d, 0) for d in deltas[:n])
    loss = fmean(max(-d, 0) for d in deltas[:n])
    for d in deltas[n:]:
        gain = (gain * (n - 1) + max(d, 0)) / n
        loss = (loss * (n - 1) + max(-d, 0)) / n
    if gain == 0 and loss == 0:
        return 50.0
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


def realised_volatility(points: list[tuple[dt.datetime, float]]) -> float | None:
    """Annualised volatility from realised variance over calendar time.

    sqrt(sum of squared log returns / years): unbiased by irregular spacing,
    unlike stdev(returns) * sqrt(periods per year).
    """
    if len(points) < 3:
        return None
    years = (points[-1][0] - points[0][0]).total_seconds() / (365.25 * 86400)
    if years <= 0:
        return None
    squared = sum(math.log(b / a) ** 2 for (_, a), (_, b) in zip(points, points[1:]))
    return round(math.sqrt(squared / years) * 100, 2)


def summarize(chart: dict[str, Any], *, technicals: bool = True) -> dict[str, Any]:
    pts = series(chart)
    if len(pts) < 2:
        return {"points": len(pts), "insufficient_data": True}
    prices = [p for _, p in pts]
    first_t, first = pts[0]
    last_t, last = pts[-1]
    years = (last_t - first_t).total_seconds() / (365.25 * 86400)
    hi, lo = max(prices), min(prices)
    gaps = [(b - a).total_seconds() / 86400 for (a, _), (b, _) in zip(pts, pts[1:])]
    out: dict[str, Any] = {
        "timeframe": chart.get("timeframe"),
        "currency": chart.get("currency"),
        "points": len(pts),
        "median_sampling_days": round(median(gaps), 2),
        "from": first_t.isoformat(),
        "to": last_t.isoformat(),
        "first": round(first, 4),
        "last": round(last, 4),
        "return_pct": round((last / first - 1) * 100, 2),
        "high": round(hi, 4),
        "low": round(lo, 4),
        "below_high_pct": round((last / hi - 1) * 100, 2),
        "above_low_pct": round((last / lo - 1) * 100, 2),
        "volatility_annualized_pct": realised_volatility(pts),
        "max_drawdown": max_drawdown(pts),
    }
    if years >= 1.5:
        out["cagr_pct"] = round(((last / first) ** (1 / years) - 1) * 100, 2)
    if technicals:
        out["rsi_14_samples"] = rsi(prices)
        for days in (20, 50, 200):
            avg = sma_days(pts, days)
            if avg is not None:
                out[f"sma_{days}d"] = round(avg, 4)
                out[f"vs_sma_{days}d_pct"] = round((last / avg - 1) * 100, 2)
    return out
