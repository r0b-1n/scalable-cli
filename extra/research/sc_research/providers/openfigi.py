"""OpenFIGI: ISIN -> listings (ticker, exchange, name). Keyless; OPENFIGI_API_KEY raises limits."""

from __future__ import annotations

import os
from typing import Any

from .. import http
from ..provenance import Unavailable

URL = "https://api.openfigi.com/v3/mapping"
TTL = 30 * 24 * 3600

# Preferred composite exchange per ISIN country prefix.
HOME_EXCHANGE = {"US": "US", "DE": "GR", "GB": "LN", "FR": "FP", "NL": "NA", "CH": "SW", "IE": "ID", "IT": "IM", "ES": "SM"}


def parse_mapping(entry: dict[str, Any], isin: str) -> dict[str, Any]:
    listings = entry.get("data") or []
    if not listings:
        raise Unavailable(entry.get("warning") or entry.get("error") or f"No FIGI listing for {isin}")
    composites = [x for x in listings if x.get("figi") and x.get("figi") == x.get("compositeFIGI")] or listings
    home = HOME_EXCHANGE.get(isin[:2].upper())
    primary = next((x for x in composites if x.get("exchCode") == home), composites[0])
    us = next((x for x in composites if x.get("exchCode") == "US"), None)
    pick = lambda x: {k: x.get(k) for k in ("ticker", "exchCode", "name", "securityType", "marketSector", "figi")}  # noqa: E731
    return {
        "primary": pick(primary),
        "us_listing": pick(us) if us else None,
        "composite_listings": [pick(x) for x in composites[:10]],
    }


def map_isin(isin: str) -> dict[str, Any]:
    headers = {}
    if key := os.environ.get("OPENFIGI_API_KEY"):
        headers["X-OPENFIGI-APIKEY"] = key
    response = http.get_json(URL, method="POST", body=[{"idType": "ID_ISIN", "idValue": isin}], headers=headers)
    return parse_mapping(response[0] if response else {}, isin)
