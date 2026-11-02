"""GDELT DOC 2.0: worldwide online news coverage. Keyless, one request per ~5 seconds."""

from __future__ import annotations

import datetime as dt
import json
import re
import urllib.parse
from typing import Any

from .. import http

URL = "https://api.gdeltproject.org/api/v2/doc/doc"
TTL = 30 * 60

_LEGAL_SUFFIX = re.compile(
    r"\b(inc|corp|corporation|co|ltd|plc|ag|se|sa|nv|n\.v|spa|s\.p\.a|kgaa|gmbh|holding|holdings|group|class [a-z])\.?$",
    re.IGNORECASE,
)


def company_query(name: str) -> str:
    """'Apple Inc.' -> '"Apple"'. Strips legal suffixes so the phrase matches coverage."""
    clean = re.sub(r"[^\w\s&-]", " ", name).strip()
    while True:
        stripped = _LEGAL_SUFFIX.sub("", clean).strip()
        if stripped == clean or not stripped:
            break
        clean = stripped
    return f'"{clean}"'


def parse_artlist(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    if text.startswith("Please limit requests"):
        raise http.RateLimited(URL, 429, text[:200])
    if not text.startswith("{"):
        raise http.HttpError(URL, 200, f"unexpected GDELT response: {text[:200]}")
    articles = json.loads(text).get("articles") or []
    out = []
    for a in articles:
        seen = a.get("seendate")
        try:
            published = dt.datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.UTC).isoformat() if seen else None
        except ValueError:
            published = seen
        out.append(
            {
                "title": a.get("title"),
                "url": a.get("url"),
                "domain": a.get("domain"),
                "language": a.get("language"),
                "source_country": a.get("sourcecountry"),
                "seen_utc": published,
            }
        )
    return out


def articles(query: str, *, days: int = 7, max_records: int = 25) -> list[dict[str, Any]]:
    params = {
        "query": query,
        "mode": "artlist",
        "format": "json",
        "sort": "datedesc",
        "maxrecords": str(max(1, min(max_records, 250))),
        "timespan": f"{max(1, min(days, 90))}d",
    }
    return parse_artlist(http.get_text(f"{URL}?{urllib.parse.urlencode(params)}", retries=1))
