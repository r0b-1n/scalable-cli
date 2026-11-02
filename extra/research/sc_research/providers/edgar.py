"""SEC EDGAR: XBRL fundamentals (companyfacts) and recent filings (submissions).

SEC fair-access policy requires a User-Agent naming you and a contact address,
so this provider only runs when SEC_USER_AGENT is set, e.g.
`SEC_USER_AGENT="Jane Doe jane@example.com"`. Covers SEC registrants: US
companies (10-K/10-Q, us-gaap) and foreign filers (20-F/40-F, often ifrs-full).

Correctness rules, because agents act on these numbers:
- One reporting currency for every monetary metric; facts in other units are ignored.
- Ratios only combine facts that cover the same period end.
- Facts older than STALE_AFTER_DAYS are flagged and kept out of ratios and valuation.
- Per-share facts are not split-safe across filings, so valuation multiples use
  totals (market cap / net income, dividends paid / market cap).
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

STALE_AFTER_DAYS = 550
VALUATION_BASIS_WARN_DAYS = 400

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
FOREIGN_ANNUAL_FORMS = {"20-F", "20-F/A", "40-F", "40-F/A"}
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
    "capex": [
        ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
        ("ifrs-full", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),
    ],
    "dividends_paid": [
        ("us-gaap", "PaymentsOfDividends"),
        ("us-gaap", "PaymentsOfDividendsCommonStock"),
        ("ifrs-full", "DividendsPaidClassifiedAsFinancingActivities"),
    ],
    "dividends_per_share": [
        ("us-gaap", "CommonStockDividendsPerShareDeclared"),
        ("us-gaap", "CommonStockDividendsPerShareCashPaid"),
        ("ifrs-full", "DividendsRecognisedAsDistributionsToOwnersPerShare"),
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
PER_SHARE_METRICS = {"eps_diluted", "dividends_per_share"}
SHARE_COUNT_METRICS = {"shares_outstanding"}

FILING_FORMS = {"10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "DEF 14A", "S-1", "SC 13D", "SC 13G", "4"}


def user_agent() -> str:
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if not ua or "@" not in ua:
        raise Unavailable("SEC EDGAR needs SEC_USER_AGENT='Your Name your@email' (SEC fair-access policy)")
    return ua


def _get(url: str) -> Any:
    return http.get_json(url, headers={"User-Agent": user_agent()})


def company_tickers() -> dict[str, Any]:
    return _get(TICKERS_URL)


def company_facts(cik: int) -> dict[str, Any]:
    return _get(FACTS_URL.format(cik=cik))


def submissions(cik: int) -> dict[str, Any]:
    return _get(SUBMISSIONS_URL.format(cik=cik))


# ---------------------------------------------------------------- identity

_STOP = {"inc", "corp", "corporation", "co", "ltd", "plc", "ag", "se", "sa", "nv", "the", "company", "holdings", "group", "class", "a", "b", "c"}


def _norm(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in _STOP and len(w) > 1}


def names_match(a: str, b: str) -> bool:
    """Guard against ticker collisions: one name's words must all appear in the other."""
    x, y = _norm(a), _norm(b)
    return bool(x and y) and (x <= y or y <= x)


def find_cik(tickers: dict[str, Any], ticker: str | None, expected_name: str) -> dict[str, Any]:
    """Resolve by ticker (name-checked), else by an exact, unique company-name match.

    The name fallback covers foreign companies whose US ADR trades under a
    different ticker than the home listing (NOVOB in Copenhagen, NVO on the SEC).
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
    key = frozenset(_norm(expected_name))
    if key:
        hits = [r for r in rows if frozenset(_norm(r.get("title", ""))) == key]
        if len({int(r["cik_str"]) for r in hits}) == 1:
            row = hits[0]
            return {"cik": int(row["cik_str"]), "title": row.get("title"), "ticker": row.get("ticker"), "matched_by": "name"}
    if collision:
        raise Unavailable(f"SEC ticker {ticker} belongs to {collision!r}, not {expected_name!r}")
    raise Unavailable(f"No SEC registrant found for {expected_name!r} (ticker {ticker})")


# ------------------------------------------------------------ fact helpers

def _date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _days(f: dict[str, Any]) -> int | None:
    return (_date(f["end"]) - _date(f["start"])).days if f.get("start") else None


def _year_before(end: str) -> dt.date:
    # 365 days, not replace(year=-1): that raises on Feb 29; callers allow ±10 days.
    return _date(end) - dt.timedelta(days=365)


def _near(a: str, b: dt.date, tolerance: int = 10) -> bool:
    return abs((_date(a) - b).days) <= tolerance


def _age_days(end: str, today: dt.date | None) -> int:
    return ((today or dt.date.today()) - _date(end)).days


def _is_stale(end: str | None, today: dt.date | None) -> bool:
    return end is None or _age_days(end, today) > STALE_AFTER_DAYS


def _unit_for(metric: str, currency: str | None) -> str | None:
    if metric in SHARE_COUNT_METRICS:
        return "shares"
    if currency is None:
        return None
    return f"{currency}/shares" if metric in PER_SHARE_METRICS else currency


def reporting_currency(facts: dict[str, Any]) -> str | None:
    """The currency of the most recent revenue (else net income / operating cash flow) fact."""
    for metric in ("revenue", "net_income", "operating_cash_flow"):
        best: tuple[str, str] | None = None
        for taxonomy, concept in FLOW_CONCEPTS[metric]:
            for unit, rows in (facts.get(taxonomy, {}).get(concept, {}).get("units") or {}).items():
                if re.fullmatch(r"[A-Z]{3}", unit) and rows:
                    latest = max(f["end"] for f in rows if f.get("end"))
                    if best is None or latest > best[0]:
                        best = (latest, unit)
        if best:
            return best[1]
    return None


def _facts_for(facts: dict[str, Any], candidates: list[tuple[str, str]], unit: str) -> tuple[str, list[dict[str, Any]]] | None:
    """The candidate concept, in `unit`, with the most recent data (priority breaks ties).

    Companies switch concepts over time (Apple reported `Revenues` until 2018),
    so the first candidate that has any data can be years out of date. Facts in
    other units (e.g. convenience translations) are never mixed in.
    """
    best: tuple[str, str, list[dict[str, Any]]] | None = None
    for taxonomy, concept in candidates:
        rows = (facts.get(taxonomy, {}).get(concept, {}).get("units") or {}).get(unit) or []
        rows = [f for f in rows if f.get("end") and f.get("val") is not None]
        if not rows:
            continue
        latest = max(f["end"] for f in rows)
        if best is None or latest > best[0]:
            best = (latest, f"{taxonomy}:{concept}", rows)
    return (best[1], best[2]) if best else None


def _latest_per_period(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One fact per (start, end), keeping the most recently filed (restatements win)."""
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


def _growth(cur: dict[str, Any] | None, pool: list[dict[str, Any]]) -> float | None:
    """Year-over-year change; None when the base is zero or negative (sign would mislead)."""
    if not cur:
        return None
    target = _year_before(cur["end"])
    prev = next((f for f in pool if f is not cur and _near(f["end"], target) and abs((_days(f) or 0) - (_days(cur) or 0)) <= 10), None)
    if not prev or prev["val"] <= 0:
        return None
    return round((cur["val"] / prev["val"] - 1) * 100, 2)


# ------------------------------------------------------------ metrics

def flow_metric(rows: list[dict[str, Any]], today: dt.date | None = None) -> dict[str, Any]:
    rows = _latest_per_period(rows)
    annual = [f for f in rows if f.get("form") in ANNUAL_FORMS and (d := _days(f)) and 350 <= d <= 380]
    quarters = [f for f in rows if (d := _days(f)) and 80 <= d <= 100]
    # Year-to-date facts from interim filings; a Q1 YTD is also a ~90-day fact.
    ytd = [
        f
        for f in rows
        if f.get("form") in INTERIM_FORMS and (d := _days(f)) and (100 < d < 350 or (f.get("fp") == "Q1" and 80 <= d <= 100))
    ]
    latest_annual = annual[-1] if annual else None

    ttm: dict[str, Any] | None = None
    if latest_annual:
        ttm = {"val": latest_annual["val"], "end": latest_annual["end"], "method": "latest_annual"}
        newer = [f for f in ytd if f["end"] > latest_annual["end"]]
        if newer:
            cur = newer[-1]
            prior = next(
                (f for f in ytd if _near(f["end"], _year_before(cur["end"])) and abs((_days(f) or 0) - (_days(cur) or 0)) <= 10),
                None,
            )
            if prior:
                ttm = {
                    "val": round(latest_annual["val"] + cur["val"] - prior["val"], 6),
                    "end": cur["end"],
                    "method": "annual_plus_ytd_minus_prior_ytd",
                }
        ttm["age_days"] = _age_days(ttm["end"], today)
        ttm["stale"] = _is_stale(ttm["end"], today)

    # Cash-flow concepts are filed as YTD only, so their only ~90-day facts are
    # Q1s; a quarter older than the newest reported period would be stale.
    newest_end = rows[-1]["end"] if rows else None
    latest_quarter = quarters[-1] if quarters and quarters[-1]["end"] == newest_end else None
    return {
        "ttm": ttm,
        "latest_annual": _fact(latest_annual),
        "prior_annual": _fact(annual[-2] if len(annual) > 1 else None),
        "annual_growth_pct": _growth(latest_annual, annual),
        "latest_quarter": _fact(latest_quarter),
        "quarter_yoy_growth_pct": _growth(latest_quarter, quarters),
        "quarters": [{"end": f["end"], "val": f["val"]} for f in quarters[-8:]],
    }


def stock_metric(rows: list[dict[str, Any]], today: dt.date | None = None, *, sum_classes: bool = False) -> dict[str, Any]:
    if not rows:
        return {"latest": None}
    end = max(f["end"] for f in rows)
    at_end = [f for f in rows if f["end"] == end]
    newest_filed = max(f.get("filed", "") for f in at_end)
    same_filing = [f for f in at_end if f.get("filed", "") == newest_filed]
    latest = dict(_fact(same_filing[0]) or {})
    if sum_classes and len(same_filing) > 1:
        # Multi-class issuers (e.g. Alphabet) report one cover-page count per class.
        # De-duplicate repeated facts; two classes with identical counts are rare.
        unique = {(f.get("accn"), f["val"]) for f in same_filing}
        if len(unique) > 1:
            latest["val"] = sum(v for _, v in unique)
            latest["share_classes_summed"] = len(unique)
    latest["age_days"] = _age_days(end, today)
    latest["stale"] = _is_stale(end, today)
    return {"latest": latest}


def _ratio(a: float | None, b: float | None, pct: bool = True) -> float | None:
    if a is None or not b:
        return None
    return round(a / b * (100 if pct else 1), 2)


def fundamentals(facts_doc: dict[str, Any], today: dt.date | None = None) -> dict[str, Any]:
    """Parse companyfacts. `today` anchors staleness (tests pin it)."""
    facts = facts_doc.get("facts") or {}
    currency = reporting_currency(facts)
    metrics: dict[str, Any] = {}
    for name, candidates in {**FLOW_CONCEPTS, **STOCK_CONCEPTS}.items():
        unit = _unit_for(name, currency)
        found = _facts_for(facts, candidates, unit) if unit else None
        if not found:
            continue
        concept, rows = found
        if name in FLOW_CONCEPTS:
            metrics[name] = {"concept": concept, "unit": unit, **flow_metric(rows, today)}
        else:
            metrics[name] = {"concept": concept, "unit": unit, **stock_metric(rows, today, sum_classes=name in SHARE_COUNT_METRICS)}
    if not metrics:
        raise Unavailable("No usable XBRL facts")

    def fresh(name: str, period: str) -> dict[str, Any] | None:
        fact = (metrics.get(name) or {}).get(period)
        return None if not fact or fact.get("stale", True) else fact

    def same_period(a: str, b: str) -> tuple[float, float] | None:
        x, y = fresh(a, "ttm"), fresh(b, "ttm")
        if x and y and x["end"] == y["end"]:
            return x["val"], y["val"]
        return None

    def margin(name: str) -> float | None:
        pair = same_period(name, "revenue")
        return _ratio(*pair) if pair else None

    cash_flow = same_period("operating_cash_flow", "capex")
    fcf = {"val": cash_flow[0] - cash_flow[1], "end": metrics["operating_cash_flow"]["ttm"]["end"]} if cash_flow else None
    revenue = fresh("revenue", "ttm")
    ni, equity = fresh("net_income", "ttm"), fresh("equity", "latest")
    debt = fresh("long_term_debt", "latest")
    dps = fresh("dividends_per_share", "ttm")

    annual_form = ((metrics.get("revenue") or metrics.get("net_income") or {}).get("latest_annual") or {}).get("form")
    ratios = {
        "gross_margin_pct": margin("gross_profit"),
        "operating_margin_pct": margin("operating_income"),
        "net_margin_pct": margin("net_income"),
        "free_cash_flow_ttm": fcf["val"] if fcf else None,
        "fcf_margin_pct": _ratio(fcf["val"], revenue["val"]) if fcf and revenue and fcf["end"] == revenue["end"] else None,
        "return_on_equity_pct": _ratio(ni["val"], equity["val"]) if ni and equity and equity["val"] > 0 else None,
        "debt_to_equity": _ratio(debt["val"], equity["val"], pct=False) if debt and equity and debt["end"] == equity["end"] and equity["val"] > 0 else None,
        "dividends_per_share_ttm": dps["val"] if dps else None,
    }
    return {
        "entity_name": facts_doc.get("entityName"),
        "cik": facts_doc.get("cik"),
        "reporting_currency": currency,
        "filer_type": "foreign" if annual_form in FOREIGN_ANNUAL_FORMS else "domestic" if annual_form else None,
        "metrics": metrics,
        "ratios": ratios,
        "notes": [
            "TTM = latest annual + current YTD - prior-year YTD; method 'latest_annual' means no newer interim data.",
            "Ratios only combine facts with the same period end; growth is null for a zero or negative base.",
            f"Facts older than {STALE_AFTER_DAYS} days are flagged stale and left out of ratios and valuation.",
            "Per-share facts (EPS, DPS) can mix pre- and post-split bases across filings; valuation uses totals.",
        ],
    }


def valuation(fund: dict[str, Any], price_in_reporting_ccy: float | None, *, today: dt.date | None = None) -> dict[str, Any]:
    """Market-price-based multiples. The price must already be in the reporting currency.

    Split-safe by construction: market cap = price x cover-page shares, and every
    multiple divides totals by market cap instead of using per-share facts.
    """
    if price_in_reporting_ccy is None:
        return {"available": False, "reason": "no price in the reporting currency"}
    m = fund["metrics"]

    def fresh(name: str, period: str) -> dict[str, Any] | None:
        fact = (m.get(name) or {}).get(period)
        return None if not fact or fact.get("stale", True) else fact

    shares = fresh("shares_outstanding", "latest")
    if not shares:
        return {"available": False, "reason": "no current shares-outstanding figure"}
    mcap = price_in_reporting_ccy * shares["val"]
    ni, revenue, divs = fresh("net_income", "ttm"), fresh("revenue", "ttm"), fresh("dividends_paid", "ttm")
    fcf = fund["ratios"].get("free_cash_flow_ttm")
    basis = ni or revenue
    out: dict[str, Any] = {
        "available": True,
        "currency": fund.get("reporting_currency"),
        "price_in_reporting_currency": round(price_in_reporting_ccy, 4),
        "market_cap": round(mcap),
        "pe_ttm": _ratio(mcap, ni["val"], pct=False) if ni and ni["val"] > 0 else None,
        "ps_ttm": _ratio(mcap, revenue["val"], pct=False) if revenue else None,
        "fcf_yield_pct": _ratio(fcf, mcap),
        "dividend_yield_pct": _ratio(abs(divs["val"]), mcap) if divs else None,
        "method": "market_cap = price x shares_outstanding; multiples use totals (split-safe)",
    }
    if basis:
        out["earnings_basis_end"] = basis["end"]
        out["earnings_basis_age_days"] = _age_days(basis["end"], today)
        out["earnings_basis_older_than_400d"] = out["earnings_basis_age_days"] > VALUATION_BASIS_WARN_DAYS
    if shares.get("share_classes_summed"):
        out["share_classes_summed"] = shares["share_classes_summed"]
    return out


# ----------------------------------------------------------------- filings

def recent_filings(sub: dict[str, Any], limit: int = 15, today: dt.date | None = None) -> dict[str, Any]:
    recent = (sub.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    n = len(forms)
    cik = int(sub.get("cik") or 0)
    out = []
    insider_90d = 0
    cutoff = ((today or dt.date.today()) - dt.timedelta(days=90)).isoformat()
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
                "report_date": (recent.get("reportDate") or [None] * n)[i] or None,
                "description": (recent.get("primaryDocDescription") or [""] * n)[i] or None,
                "items": (recent.get("items") or [""] * n)[i] or None,
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
