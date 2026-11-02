"""SEC EDGAR: XBRL fundamentals (companyfacts) and recent filings (submissions).

SEC fair-access policy requires a User-Agent naming you and a contact address,
so this provider only runs when SEC_USER_AGENT is set, e.g.
`SEC_USER_AGENT="Jane Doe jane@example.com"`. Covers SEC registrants: US
companies (10-K/10-Q, us-gaap) and foreign filers (20-F/40-F, often ifrs-full).
"""

from __future__ import annotations

import datetime as dt
import os
import re
from typing import Any

from .. import http
from ..provenance import Unavailable

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
TICKERS_TTL = 7 * 24 * 3600
FACTS_TTL = 12 * 3600
SUBMISSIONS_TTL = 3600

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
INTERIM_FORMS = {"10-Q", "10-Q/A", "6-K"}

# metric -> candidate (taxonomy, concept) in priority order; flows are period
# sums, stocks are point-in-time balances.
FLOW_CONCEPTS: dict[str, list[tuple[str, str]]] = {
    "revenue": [
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("us-gaap", "Revenues"),
        ("us-gaap", "SalesRevenueNet"),
        ("ifrs-full", "Revenue"),
    ],
    "gross_profit": [("us-gaap", "GrossProfit"), ("ifrs-full", "GrossProfit")],
    "operating_income": [("us-gaap", "OperatingIncomeLoss"), ("ifrs-full", "ProfitLossFromOperatingActivities")],
    "net_income": [
        ("us-gaap", "NetIncomeLoss"),
        ("ifrs-full", "ProfitLossAttributableToOwnersOfParent"),
        ("ifrs-full", "ProfitLoss"),
    ],
    "eps_diluted": [("us-gaap", "EarningsPerShareDiluted"), ("ifrs-full", "DilutedEarningsLossPerShare")],
    "operating_cash_flow": [
        ("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
        ("ifrs-full", "CashFlowsFromUsedInOperatingActivities"),
    ],
    "dividends_per_share": [
        ("us-gaap", "CommonStockDividendsPerShareDeclared"),
        ("us-gaap", "CommonStockDividendsPerShareCashPaid"),
        ("ifrs-full", "DividendsRecognisedAsDistributionsToOwnersPerShare"),
    ],
    "capex": [
        ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
        ("ifrs-full", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),
    ],
}
STOCK_CONCEPTS: dict[str, list[tuple[str, str]]] = {
    "cash": [("us-gaap", "CashAndCashEquivalentsAtCarryingValue"), ("ifrs-full", "CashAndCashEquivalents")],
    "long_term_debt": [("us-gaap", "LongTermDebt"), ("us-gaap", "LongTermDebtNoncurrent"), ("ifrs-full", "NoncurrentFinancialLiabilities")],
    "equity": [
        ("us-gaap", "StockholdersEquity"),
        ("ifrs-full", "EquityAttributableToOwnersOfParent"),
        ("ifrs-full", "Equity"),
    ],
    "shares_outstanding": [("dei", "EntityCommonStockSharesOutstanding")],
}

FILING_FORMS = {"10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1", "SC 13D", "SC 13G", "4"}


def user_agent() -> str:
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if not ua or "@" not in ua:
        raise Unavailable("SEC EDGAR needs SEC_USER_AGENT='Your Name your@email' (SEC fair-access policy)")
    return ua


def _get(url: str) -> Any:
    return http.get_json(url, headers={"User-Agent": user_agent()})


# ---------------------------------------------------------------- identity

def _norm(name: str) -> set[str]:
    stop = {"inc", "corp", "corporation", "co", "ltd", "plc", "ag", "se", "sa", "nv", "the", "company", "holdings", "group", "class", "a", "b"}
    return {w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in stop}


def names_match(a: str, b: str) -> bool:
    """Guard against ticker collisions across exchanges: names must share a word."""
    return bool(_norm(a) & _norm(b))


def _name_key(name: str) -> frozenset[str]:
    """Strict identity for name lookup: 'Novo Nordisk A/S' == 'NOVO NORDISK A S'."""
    return frozenset(w for w in _norm(name) if len(w) > 1)


def find_cik(tickers: dict[str, Any], ticker: str | None, expected_name: str) -> dict[str, Any]:
    """Resolve by ticker (name-checked), else by an exact company-name match.

    The name fallback covers foreign companies whose US ADR trades under a
    different ticker than the home listing (NOVOB in Copenhagen, NVO on the
    SEC); it only accepts a single, exact match.
    """
    rows = list(tickers.values())
    collision = None
    if ticker:
        for row in rows:
            if str(row.get("ticker", "")).upper() == ticker.upper():
                if names_match(row.get("title", ""), expected_name):
                    return {"cik": int(row["cik_str"]), "title": row.get("title"), "ticker": row.get("ticker"), "matched_by": "ticker"}
                collision = row.get("title")
                break
    key = _name_key(expected_name)
    if key:
        hits = [r for r in rows if _name_key(r.get("title", "")) == key]
        if len({int(r["cik_str"]) for r in hits}) == 1:
            row = hits[0]
            return {"cik": int(row["cik_str"]), "title": row.get("title"), "ticker": row.get("ticker"), "matched_by": "name"}
    if collision:
        raise Unavailable(f"SEC ticker {ticker} belongs to {collision!r}, not {expected_name!r}")
    raise Unavailable(f"No SEC registrant found for {expected_name!r} (ticker {ticker})")


def company_tickers() -> dict[str, Any]:
    return _get(TICKERS_URL)


def company_facts(cik: int) -> dict[str, Any]:
    return _get(FACTS_URL.format(cik=cik))


def submissions(cik: int) -> dict[str, Any]:
    return _get(SUBMISSIONS_URL.format(cik=cik))


# ------------------------------------------------------------ fundamentals

def _date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _days(f: dict[str, Any]) -> int | None:
    return (_date(f["end"]) - _date(f["start"])).days if f.get("start") else None


STALE_AFTER_DAYS = 550


def _facts_for(facts: dict[str, Any], candidates: list[tuple[str, str]]) -> tuple[str, str, list[dict[str, Any]]] | None:
    """The candidate concept with the most recent data; priority order breaks ties.

    Companies switch concepts over time (Apple reported `Revenues` until 2018),
    so the first candidate that has any data can be years out of date.
    """
    best: tuple[str, int, tuple[str, str, list[dict[str, Any]]]] | None = None
    for priority, (taxonomy, concept) in enumerate(candidates):
        units = facts.get(taxonomy, {}).get(concept, {}).get("units") or {}
        if not units:
            continue
        unit = next((u for u in units if re.fullmatch(r"[A-Z]{3}(/shares)?|shares", u)), next(iter(units)))
        rows = [f for f in units[unit] if f.get("end") and f.get("val") is not None]
        if not rows:
            continue
        latest = max(f["end"] for f in rows)
        if best is None or latest > best[0]:
            best = (latest, priority, (f"{taxonomy}:{concept}", unit, rows))
    return best[2] if best else None


def _is_stale(end: str | None, today: dt.date | None = None) -> bool:
    return end is None or ((today or dt.date.today()) - _date(end)).days > STALE_AFTER_DAYS


def _latest_per_end(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One fact per period end, keeping the most recently filed (restatements win)."""
    best: dict[tuple[str, str | None], dict[str, Any]] = {}
    for f in rows:
        key = (f["end"], f.get("start"))
        if key not in best or f.get("filed", "") > best[key].get("filed", ""):
            best[key] = f
    return sorted(best.values(), key=lambda f: f["end"])


def _fact(f: dict[str, Any] | None) -> dict[str, Any] | None:
    if not f:
        return None
    return {k: f.get(k) for k in ("val", "start", "end", "form", "filed", "fy", "fp", "accn") if f.get(k) is not None}


def _near(a: str, b: dt.date, tolerance: int = 10) -> bool:
    return abs((_date(a) - b).days) <= tolerance


def flow_metric(rows: list[dict[str, Any]], today: dt.date | None = None) -> dict[str, Any]:
    rows = _latest_per_end(rows)
    annual = [f for f in rows if f.get("form") in ANNUAL_FORMS and (d := _days(f)) and 350 <= d <= 380]
    quarters = [f for f in rows if (d := _days(f)) and 80 <= d <= 100]
    ytd = [f for f in rows if f.get("form") in INTERIM_FORMS and (d := _days(f)) and 100 < d < 350]
    latest_annual = annual[-1] if annual else None
    prior_annual = annual[-2] if len(annual) > 1 else None

    ttm: dict[str, Any] | None = None
    if latest_annual:
        ttm = {"val": latest_annual["val"], "end": latest_annual["end"], "method": "latest_annual"}
        newer_ytd = [f for f in ytd if f["end"] > latest_annual["end"]]
        if newer_ytd:
            cur = newer_ytd[-1]
            cur_end = _date(cur["end"])
            prior_end = cur_end.replace(year=cur_end.year - 1)
            prior = next(
                (f for f in ytd if _near(f["end"], prior_end) and abs((_days(f) or 0) - (_days(cur) or 0)) <= 10),
                None,
            )
            if prior:
                ttm = {
                    "val": round(latest_annual["val"] + cur["val"] - prior["val"], 6),
                    "end": cur["end"],
                    "method": "annual_plus_ytd_minus_prior_ytd",
                }

    def yoy(cur: dict[str, Any] | None, pool: list[dict[str, Any]]) -> float | None:
        if not cur:
            return None
        cur_end = _date(cur["end"])
        target = cur_end.replace(year=cur_end.year - 1)
        prev = next((f for f in pool if _near(f["end"], target) and f is not cur), None)
        if not prev or not prev["val"]:
            return None
        return round((cur["val"] / prev["val"] - 1) * 100, 2)

    # Cash-flow concepts are filed as YTD only, so their only ~90-day facts are
    # Q1s; a quarter older than the newest reported period would be stale.
    newest_end = max(f["end"] for f in rows) if rows else None
    latest_quarter = quarters[-1] if quarters and quarters[-1]["end"] == newest_end else None
    if ttm is not None:
        ttm["stale"] = _is_stale(ttm["end"], today)
    return {
        "ttm": ttm,
        "latest_annual": _fact(latest_annual),
        "prior_annual": _fact(prior_annual),
        "annual_growth_pct": yoy(latest_annual, annual),
        "latest_quarter": _fact(latest_quarter),
        "quarter_yoy_growth_pct": yoy(latest_quarter, quarters),
        "quarters": [{"end": f["end"], "val": f["val"]} for f in quarters[-8:]],
    }


def stock_metric(rows: list[dict[str, Any]], today: dt.date | None = None) -> dict[str, Any]:
    rows = _latest_per_end(rows)
    latest = _fact(rows[-1]) if rows else None
    if latest is not None:
        latest["stale"] = _is_stale(latest["end"], today)
    return {"latest": latest}


def _ratio(a: float | None, b: float | None, pct: bool = True) -> float | None:
    if a is None or not b:
        return None
    return round(a / b * (100 if pct else 1), 2)


def fundamentals(facts_doc: dict[str, Any], today: dt.date | None = None) -> dict[str, Any]:
    """`today` anchors the staleness check (tests pin it)."""
    facts = facts_doc.get("facts") or {}
    metrics: dict[str, Any] = {}
    currency = None
    for name, candidates in FLOW_CONCEPTS.items():
        found = _facts_for(facts, candidates)
        if found:
            concept, unit, rows = found
            metrics[name] = {"concept": concept, "unit": unit, **flow_metric(rows, today)}
            if name == "revenue":
                currency = unit
    for name, candidates in STOCK_CONCEPTS.items():
        found = _facts_for(facts, candidates)
        if found:
            concept, unit, rows = found
            metrics[name] = {"concept": concept, "unit": unit, **stock_metric(rows, today)}
    if not metrics:
        raise Unavailable("No usable XBRL facts")

    def fresh(name: str, period: str) -> float | None:
        fact = (metrics.get(name) or {}).get(period) or {}
        return None if fact.get("stale", True) else fact.get("val")

    def ttm(name: str) -> float | None:
        return fresh(name, "ttm")

    def latest(name: str) -> float | None:
        return fresh(name, "latest")

    ocf, capex = ttm("operating_cash_flow"), ttm("capex")
    fcf = ocf - capex if ocf is not None and capex is not None else None
    ratios = {
        "gross_margin_pct": _ratio(ttm("gross_profit"), ttm("revenue")),
        "operating_margin_pct": _ratio(ttm("operating_income"), ttm("revenue")),
        "net_margin_pct": _ratio(ttm("net_income"), ttm("revenue")),
        "free_cash_flow_ttm": fcf,
        "fcf_margin_pct": _ratio(fcf, ttm("revenue")),
        "return_on_equity_pct": _ratio(ttm("net_income"), latest("equity")),
        "debt_to_equity": _ratio(latest("long_term_debt"), latest("equity"), pct=False),
        "dividends_per_share_ttm": ttm("dividends_per_share"),
    }
    return {
        "entity_name": facts_doc.get("entityName"),
        "cik": facts_doc.get("cik"),
        "reporting_currency": currency,
        "metrics": metrics,
        "ratios": ratios,
        "notes": [
            "TTM = latest annual + current YTD - prior-year YTD (EPS TTM is an additive approximation).",
            "Values are as reported in XBRL; restatements replace earlier filings for the same period.",
            f"Facts older than {STALE_AFTER_DAYS} days are flagged stale and left out of ratios and valuation.",
        ],
    }


def valuation(fund: dict[str, Any], price_in_reporting_ccy: float | None) -> dict[str, Any]:
    """Market-price-based multiples; price must already be in the reporting currency."""
    m = fund["metrics"]

    def fresh(name: str, period: str) -> float | None:
        fact = (m.get(name) or {}).get(period) or {}
        return None if fact.get("stale", True) else fact.get("val")

    shares = fresh("shares_outstanding", "latest")
    eps = fresh("eps_diluted", "ttm")
    revenue = fresh("revenue", "ttm")
    fcf = fund["ratios"].get("free_cash_flow_ttm")
    dps = fund["ratios"].get("dividends_per_share_ttm")
    if price_in_reporting_ccy is None:
        return {"available": False, "reason": "no price in reporting currency"}
    mcap = price_in_reporting_ccy * shares if shares else None
    return {
        "available": True,
        "price_in_reporting_currency": round(price_in_reporting_ccy, 4),
        "market_cap": round(mcap) if mcap else None,
        "pe_ttm": _ratio(price_in_reporting_ccy, eps, pct=False) if eps and eps > 0 else None,
        "ps_ttm": _ratio(mcap, revenue, pct=False),
        "fcf_yield_pct": _ratio(fcf, mcap),
        "dividend_yield_pct": _ratio(dps, price_in_reporting_ccy),
    }


# ----------------------------------------------------------------- filings

def recent_filings(sub: dict[str, Any], limit: int = 15) -> dict[str, Any]:
    recent = (sub.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    cik = int(sub.get("cik") or 0)
    out = []
    insider_90d = 0
    cutoff = (dt.date.today() - dt.timedelta(days=90)).isoformat()
    for i, form in enumerate(forms):
        filed = recent["filingDate"][i]
        if form == "4" and filed >= cutoff:
            insider_90d += 1
        if form not in FILING_FORMS or form == "4" or len(out) >= limit:
            continue
        accession = recent["accessionNumber"][i]
        doc = recent["primaryDocument"][i]
        out.append(
            {
                "form": form,
                "filed": filed,
                "report_date": recent.get("reportDate", [None] * len(forms))[i] or None,
                "description": (recent.get("primaryDocDescription") or [""] * len(forms))[i] or None,
                "items": (recent.get("items") or [""] * len(forms))[i] or None,
                "url": f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{doc}",
            }
        )
    return {
        "company": sub.get("name"),
        "sic_description": sub.get("sicDescription"),
        "fiscal_year_end": sub.get("fiscalYearEnd"),
        "exchanges": sub.get("exchanges"),
        "insider_form4_filings_last_90d": insider_90d,
        "filings": out,
    }
