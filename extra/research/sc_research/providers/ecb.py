"""European Central Bank Data Portal: reference FX rates and key policy rates. Keyless."""

from __future__ import annotations

import csv
import io
from typing import Any

from .. import http

BASE = "https://data-api.ecb.europa.eu/service/data"
FX_TTL = 6 * 3600
RATES_TTL = 12 * 3600

KEY_RATES = {
    "DFR": "deposit_facility",
    "MRR_FR": "main_refinancing_fixed",
    "MLFR": "marginal_lending_facility",
}


def _rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def parse_fx(text: str) -> dict[str, Any]:
    """Units of currency per 1 EUR, latest and previous observation."""
    series: dict[str, list[tuple[str, float]]] = {}
    for row in _rows(text):
        if row.get("OBS_VALUE"):
            series.setdefault(row["CURRENCY"], []).append((row["TIME_PERIOD"], float(row["OBS_VALUE"])))
    out = {}
    for ccy, obs in series.items():
        obs.sort()
        date, rate = obs[-1]
        prev = obs[-2][1] if len(obs) > 1 else None
        out[ccy] = {
            "per_eur": rate,
            "date": date,
            "change_pct": round((rate / prev - 1) * 100, 4) if prev else None,
        }
    return out


def parse_key_rates(text: str) -> dict[str, Any]:
    out = {}
    for row in _rows(text):
        name = KEY_RATES.get(row.get("PROVIDER_FM_ID", ""))
        if name and row.get("OBS_VALUE"):
            out[name] = {"rate_pct": float(row["OBS_VALUE"]), "effective_since": row["TIME_PERIOD"]}
    return out


def fx_rates(currencies: list[str]) -> dict[str, Any]:
    keys = "+".join(sorted({c.upper() for c in currencies if c.upper() != "EUR"}))
    if not keys:
        return {}
    return parse_fx(http.get_text(f"{BASE}/EXR/D.{keys}.EUR.SP00.A?lastNObservations=2&format=csvdata"))


def key_rates() -> dict[str, Any]:
    ids = "+".join(KEY_RATES)
    return parse_key_rates(http.get_text(f"{BASE}/FM/B.U2.EUR.4F.KR.{ids}.LEV?lastNObservations=1&format=csvdata"))


def convert(amount: float, from_ccy: str, to_ccy: str, rates: dict[str, Any]) -> float | None:
    """Convert via EUR using ECB per-EUR rates; None if a rate is missing."""
    from_ccy, to_ccy = from_ccy.upper(), to_ccy.upper()
    if from_ccy == to_ccy:
        return amount
    try:
        eur = amount if from_ccy == "EUR" else amount / rates[from_ccy]["per_eur"]
        return eur if to_ccy == "EUR" else eur * rates[to_ccy]["per_eur"]
    except (KeyError, TypeError, ZeroDivisionError):
        return None
