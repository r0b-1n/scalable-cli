"""Composes portfolio snapshots and per-security research dossiers for agents.

Two-stage fan-out: stage 1 reads Scalable (via `sc`) and resolves identity;
stage 2 uses the resolved name/ticker for fundamentals, filings and news.
Every section is wrapped by `provenance.section`, so a failing source shows up
as a status, never as missing or invented data.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import metrics, sc
from .cache import Cache
from .provenance import Unavailable, now_iso, section
from .providers import ecb, edgar, gdelt, openfigi

ALL_SECTIONS = (
    "quote",
    "price_1y",
    "price_max",
    "position",
    "activity",
    "news_scalable",
    "identity",
    "fundamentals",
    "filings",
    "news_global",
    "fx",
)

# sc read TTLs (seconds): short for live data, longer for history.
SC_TTL = {"quote": 60, "chart_1y": 3600, "chart_max": 6 * 3600, "news": 900, "account": 60}

ScRunner = Callable[[list[str]], Any]

# Environment that changes which backend/account `sc` talks to.
TARGET_ENV = (
    "SC_MOCK",
    "SC_MOCK_PORT",
    "SC_GRAPHQL_URL",
    "SC_OAUTH_ISSUER",
    "SC_OAUTH_CLIENT_ID",
    "SC_OAUTH_AUDIENCE",
    "SC_CONFIG_DIR",
    "SC_SESSION_BACKEND",
    "SC_BIN",
)
FX_MAX_AGE_DAYS = 10  # older ECB rates mean a discontinued or unpublished currency


def _env_fingerprint() -> str:
    """Separates cache entries per CLI target (mock vs. real, config dir)."""
    parts = [os.environ.get(k, "") for k in TARGET_ENV]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:12]


class Research:
    def __init__(self, sc_run: ScRunner | None = None, cache: Cache | None = None, max_workers: int = 6) -> None:
        self._sc_run = sc_run or sc.run
        self.cache = cache or Cache()
        self.max_workers = max_workers
        self._env = _env_fingerprint()

    # ------------------------------------------------------------ helpers

    def _sc(self, args: list[str], ttl: float) -> tuple[Any, float]:
        return self.cache.fetch(f"sc:{self._env}:{json.dumps(args)}", ttl, lambda: self._sc_run(args))

    def _cached(self, key: str, ttl: float, produce: Callable[[], Any]) -> tuple[Any, float]:
        return self.cache.fetch(key, ttl, produce)

    def _parallel(self, jobs: dict[str, Callable[[], dict[str, Any]]]) -> dict[str, dict[str, Any]]:
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {name: pool.submit(job) for name, job in jobs.items()}
            return {name: f.result() for name, f in futures.items()}

    # ----------------------------------------------------------- sources

    def quote(self, isin: str) -> dict[str, Any]:
        return section("scalable:sc broker quote", lambda: self._sc(["broker", "quote", "--isin", isin], SC_TTL["quote"]))

    def _chart_metrics(self, isin: str, timeframe: str) -> dict[str, Any]:
        def produce() -> tuple[Any, float]:
            data, fetched = self._sc(["broker", "chart", "--isin", isin, "--timeframe", timeframe], SC_TTL[f"chart_{timeframe}"])
            # Short-horizon technicals only make sense on the 1y series.
            return metrics.summarize(data, technicals=timeframe == "1y"), fetched

        return section(f"derived:metrics(sc broker chart --timeframe {timeframe})", produce, derived=True)

    def _holdings(self) -> tuple[Any, float]:
        return self._sc(["broker", "holdings"], SC_TTL["account"])

    def position(self, isin: str) -> dict[str, Any]:
        def produce() -> tuple[Any, float]:
            data, fetched = self._holdings()
            result = data.get("result", data)
            items = list(result.get("items") or []) + list(result.get("crypto_items") or [])
            total = sum(float(i.get("valuation") or 0) for i in items)
            item = next((i for i in items if i.get("isin") == isin), None)
            if item is None:
                return {"held": False}, fetched
            return {"held": True, **_position_view(item, total)}, fetched

        return section("scalable:sc broker holdings", produce)

    def activity(self, isin: str) -> dict[str, Any]:
        def produce() -> tuple[Any, float]:
            tx, fetched = self._sc(["broker", "transactions", "--isin", isin, "--page-size", "25"], SC_TTL["account"])
            plans, _ = self._sc(["broker", "savings-plans"], SC_TTL["account"])
            alerts, _ = self._sc(["broker", "price-alerts"], SC_TTL["account"])
            tx_items = [t for t in (tx.get("result", tx).get("items") or []) if t.get("isin") in (None, isin)]
            return {
                "transactions": [t for t in tx_items if t.get("isin") == isin],
                "savings_plans": [p for p in plans.get("result", plans).get("items") or [] if p.get("isin") == isin],
                "price_alerts": [a for a in alerts.get("result", alerts).get("items") or [] if a.get("isin") == isin],
            }, fetched

        return section("scalable:sc broker transactions|savings-plans|price-alerts", produce)

    def news_scalable(self, isin: str, locale: str) -> dict[str, Any]:
        return section(
            "scalable:sc broker security-news",
            lambda: self._sc(["broker", "security-news", "--isin", isin, "--locale", locale], SC_TTL["news"]),
        )

    def identity(self, isin: str) -> dict[str, Any]:
        return section("openfigi", lambda: self._cached(f"figi:{isin}", openfigi.TTL, lambda: openfigi.map_isin(isin)))

    def fundamentals(
        self,
        isin: str,
        name: str,
        identity: dict[str, Any],
        quote: dict[str, Any],
        want: set[str],
    ) -> dict[str, dict[str, Any]]:
        """Fundamentals, valuation and filings from SEC EDGAR for SEC registrants."""
        found: dict[str, Any] = {}

        def cik() -> dict[str, Any]:
            if not found:
                if identity.get("status") != "ok":
                    raise Unavailable("identity (OpenFIGI) unavailable, cannot resolve SEC registrant")
                ident = identity["data"]
                listing = ident.get("us_listing") or ident.get("primary") or {}
                tickers, _ = self._cached("sec:tickers", edgar.TICKERS_TTL, edgar.company_tickers)
                found.update(edgar.find_cik(tickers, listing.get("ticker"), name or listing.get("name") or ""))
            return found

        def facts() -> tuple[Any, float]:
            reg = cik()
            # Cache the parsed result: raw companyfacts documents are megabytes.
            fund, fetched = self._cached(
                f"sec:fund:{reg['cik']}", edgar.FACTS_TTL, lambda: edgar.fundamentals(edgar.company_facts(reg["cik"]))
            )
            fund = {**fund, "sec_registrant": reg}
            fund["valuation"] = self._valuation(isin, fund, quote)
            return fund, fetched

        def filings() -> tuple[Any, float]:
            reg = cik()
            doc, fetched = self._cached(f"sec:subs:{reg['cik']}", edgar.SUBMISSIONS_TTL, lambda: edgar.submissions(reg["cik"]))
            return edgar.recent_filings(doc), fetched

        out = {}
        if "fundamentals" in want:
            out["fundamentals"] = section("sec-edgar:companyfacts (+ecb fx for valuation)", facts)
        if "filings" in want:
            out["filings"] = section("sec-edgar:submissions", filings)
        return out

    def _valuation(self, isin: str, fund: dict[str, Any], quote: dict[str, Any]) -> dict[str, Any]:
        """Valuation multiples, or a reason why they cannot be trusted. Never raises."""
        price, price_ccy = quote.get("quote_mid_price"), quote.get("quote_currency")
        rc = fund.get("reporting_currency")
        if price is None or not price_ccy or not rc:
            return {"available": False, "reason": "no quote price/currency or no reporting currency"}
        if isin.startswith("US") and fund.get("filer_type") == "foreign":
            # A US ISIN of a 20-F/40-F filer is usually an ADR; its ratio to
            # ordinary shares is not in XBRL, so market cap would be off by it.
            return {"available": False, "reason": "likely an ADR of a foreign filer; ADR ratio unknown"}
        # Pence quotes (GBp/GBX) are 1/100 of a pound.
        if price_ccy in ("GBp", "GBX"):
            price, price_ccy = price / 100, "GBP"
        price_ccy = price_ccy.upper()
        fx_date = None
        if price_ccy != rc:
            try:
                rates, _ = self._fx([price_ccy, rc])
            except Exception as exc:  # noqa: BLE001 - only the valuation is lost
                return {"available": False, "reason": f"ECB FX unavailable: {exc}"}
            for ccy in {price_ccy, rc} - {"EUR"}:
                rate = rates.get(ccy)
                if not rate:
                    return {"available": False, "reason": f"ECB publishes no reference rate for {ccy}"}
                if (dt.date.today() - dt.date.fromisoformat(rate["date"])).days > FX_MAX_AGE_DAYS:
                    return {"available": False, "reason": f"ECB rate for {ccy} is from {rate['date']}"}
                fx_date = max(fx_date or rate["date"], rate["date"])
            price = ecb.convert(price, price_ccy, rc, rates)
        result = edgar.valuation(fund, price)
        if result.get("available"):
            result["price_source"] = {
                "quote_currency": quote.get("quote_currency"),
                "quote_timestamp_utc": quote.get("quote_timestamp_utc"),
                "quote_is_outdated": quote.get("quote_is_outdated"),
                "fx_date": fx_date,
            }
        return result

    def _fx(self, currencies: list[str]) -> tuple[Any, float]:
        wanted = sorted({c.upper() for c in currencies if c} - {"EUR"})
        return self._cached(f"ecb:fx:{','.join(wanted)}", ecb.FX_TTL, lambda: ecb.fx_rates(wanted))

    def news_global(self, query: str, days: int = 7, max_records: int = 25) -> dict[str, Any]:
        return section(
            f"gdelt:doc2 query={query}",
            lambda: self._cached(f"gdelt:{query}:{days}:{max_records}", gdelt.TTL, lambda: gdelt.articles(query, days=days, max_records=max_records)),
        )

    # ------------------------------------------------------------ products

    def security_dossier(self, isin: str, sections: list[str] | None = None, *, news_locale: str = "en_DE", news_days: int = 7) -> dict[str, Any]:
        isin = _check_isin(isin)
        want = set(sections or ALL_SECTIONS)
        unknown = want - set(ALL_SECTIONS)
        if unknown:
            raise ValueError(f"unknown sections: {sorted(unknown)}; valid: {list(ALL_SECTIONS)}")

        stage1: dict[str, Callable[[], dict[str, Any]]] = {"quote": lambda: self.quote(isin)}
        if "price_1y" in want:
            stage1["price_1y"] = lambda: self._chart_metrics(isin, "1y")
        if "price_max" in want:
            stage1["price_max"] = lambda: self._chart_metrics(isin, "max")
        if "position" in want:
            stage1["position"] = lambda: self.position(isin)
        if "activity" in want:
            stage1["activity"] = lambda: self.activity(isin)
        if "news_scalable" in want:
            stage1["news_scalable"] = lambda: self.news_scalable(isin, news_locale)
        if want & {"identity", "fundamentals", "filings"}:
            stage1["identity"] = lambda: self.identity(isin)
        out = self._parallel(stage1)

        quote = _result(out["quote"].get("data"))
        name = quote.get("name") or ""
        price_ccy = quote.get("quote_currency")

        stage2: dict[str, Callable[[], Any]] = {}
        if want & {"fundamentals", "filings"}:
            stage2["edgar"] = lambda: self.fundamentals(isin, name, out.get("identity", {}), quote, want)
        if "news_global" in want:
            stage2["news_global"] = (
                (lambda: self.news_global(gdelt.company_query(name), news_days)) if name else (lambda: section("gdelt", _no_name))
            )
        if "fx" in want:
            stage2["fx"] = lambda: section("ecb:exr", lambda: self._fx([price_ccy or "USD", "USD", "GBP", "CHF"]))
        later = self._parallel(stage2)
        if "edgar" in later:
            out.update(later.pop("edgar"))
        out.update(later)
        if "identity" not in want:
            out.pop("identity", None)

        return {
            "isin": isin,
            "name": name or None,
            "generated_at": now_iso(),
            "sections": {k: out[k] for k in ALL_SECTIONS if k in out},
            "guidance": GUIDANCE,
        }

    def portfolio_snapshot(self) -> dict[str, Any]:
        def holdings() -> tuple[Any, float]:
            data, fetched = self._holdings()
            result = data.get("result", data)
            items = list(result.get("items") or []) + list(result.get("crypto_items") or [])
            total = sum(float(i.get("valuation") or 0) for i in items)
            positions = sorted((_position_view(i, total) for i in items), key=lambda p: -(p.get("valuation") or 0))
            weights = [p["weight_pct"] / 100 for p in positions if p.get("weight_pct") is not None]
            by_type: dict[str, float] = {}
            for p in positions:
                by_type[p.get("security_type") or "OTHER"] = by_type.get(p.get("security_type") or "OTHER", 0) + (p.get("weight_pct") or 0)
            return {
                "total_valuation": round(total, 2),
                "positions": positions,
                "concentration": {
                    "positions": len(positions),
                    "top1_weight_pct": round(weights[0] * 100, 2) if weights else None,
                    "top5_weight_pct": round(sum(weights[:5]) * 100, 2) if weights else None,
                    "herfindahl_index": round(sum(w * w for w in weights), 4) if weights else None,
                    "by_security_type_pct": {k: round(v, 2) for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])},
                },
            }, fetched

        def trade_controls() -> tuple[Any, float]:
            caps, fetched = self._sc(["capabilities"], 300)
            return (caps or {}).get("local_trade_controls"), fetched

        def open_orders() -> tuple[Any, float]:
            args = ["broker", "transactions", "--page-size", "50"]
            for status in ("CREATED", "REQUESTED", "PENDING", "PARTIAL_FILLED", "CANCEL_REQUESTED"):
                args += ["--status", status]
            data, fetched = self._sc(args, SC_TTL["account"])
            return data.get("result", data).get("items") or [], fetched

        jobs: dict[str, Callable[[], dict[str, Any]]] = {
            "overview": lambda: section("scalable:sc broker overview", lambda: self._sc(["broker", "overview"], SC_TTL["account"])),
            "cash": lambda: section("scalable:sc broker cash-breakdown", lambda: self._sc(["broker", "cash-breakdown"], SC_TTL["account"])),
            "holdings": lambda: section("scalable:sc broker holdings (+derived weights)", holdings),
            "open_orders": lambda: section("scalable:sc broker transactions --status <open>", open_orders),
            "savings_plans": lambda: section("scalable:sc broker savings-plans", lambda: self._sc(["broker", "savings-plans"], SC_TTL["account"])),
            "watchlist": lambda: section("scalable:sc broker watchlist", lambda: self._sc(["broker", "watchlist"], SC_TTL["account"])),
            "price_alerts": lambda: section("scalable:sc broker price-alerts", lambda: self._sc(["broker", "price-alerts"], SC_TTL["account"])),
            "overnight": lambda: section("scalable:sc overnight", lambda: self._sc(["overnight"], SC_TTL["account"])),
            "trade_controls": lambda: section("scalable:sc capabilities (local_trade_controls)", trade_controls),
        }
        return {"generated_at": now_iso(), "sections": self._parallel(jobs), "guidance": GUIDANCE}

    def scan(self, isins: list[str]) -> dict[str, Any]:
        """Light per-security triage (quote + 1y metrics) for many ISINs."""

        def one(isin: str) -> dict[str, Any]:
            if not ISIN_RE.fullmatch(isin):
                return {"isin": isin, "errors": {"isin": "not a valid ISIN"}}
            q = self.quote(isin)
            m = self._chart_metrics(isin, "1y")
            result = _result(q.get("data"))
            stats = m.get("data") or {}
            return {
                "isin": isin,
                "name": result.get("name"),
                "security_type": result.get("security_type"),
                "price": result.get("quote_mid_price"),
                "currency": result.get("quote_currency"),
                "quote_is_outdated": result.get("quote_is_outdated"),
                "performances": result.get("quote_performances"),
                "metrics_1y": {
                    k: stats.get(k)
                    for k in ("return_pct", "volatility_annualized_pct", "below_high_pct", "rsi_14_samples", "vs_sma_50d_pct", "vs_sma_200d_pct", "median_sampling_days")
                }
                if stats
                else None,
                "max_drawdown_1y_pct": (stats.get("max_drawdown") or {}).get("pct") if stats else None,
                "errors": {k: s.get("error") or s.get("reason") for k, s in (("quote", q), ("metrics_1y", m)) if s["status"] != "ok"} or None,
            }

        unique = list(dict.fromkeys(i.strip().upper() for i in isins if i.strip()))
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            rows = list(pool.map(one, unique))
        return {"generated_at": now_iso(), "count": len(rows), "items": rows, "guidance": GUIDANCE}

    def universe(self, name: str) -> list[str]:
        if name == "holdings":
            data, _ = self._holdings()
            result = data.get("result", data)
            return [i["isin"] for i in result.get("items") or [] if i.get("isin")]
        if name == "watchlist":
            data, _ = self._sc(["broker", "watchlist"], SC_TTL["account"])
            return [i["isin"] for i in data.get("result", data).get("items") or [] if i.get("isin")]
        raise ValueError("universe must be 'holdings' or 'watchlist'")

    def market_context(self) -> dict[str, Any]:
        return {
            "generated_at": now_iso(),
            "sections": self._parallel(
                {
                    "fx": lambda: section("ecb:exr", lambda: self._fx(["USD", "GBP", "CHF", "JPY", "CNY"])),
                    "key_rates": lambda: section("ecb:fm key rates", lambda: self._cached("ecb:rates", ecb.RATES_TTL, ecb.key_rates)),
                }
            ),
        }

    def preview_trade(self, side: str, isin: str, *, amount: str | None = None, shares: str | None = None, order_type: str = "market", limit_price: str | None = None, stop_price: str | None = None, venue: str | None = None) -> dict[str, Any]:
        """Phase 1 only. Builds `sc broker trade <side>` WITHOUT --confirm."""
        # Strict shapes so no value can smuggle a flag (e.g. "--confirm") into argv.
        if side not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        if order_type not in ORDER_TYPES:
            raise ValueError(f"order_type must be one of {sorted(ORDER_TYPES)}")
        isin = isin.strip().upper()
        if not ISIN_RE.fullmatch(isin):
            raise ValueError(f"invalid ISIN {isin!r}")
        args = ["broker", "trade", side, "--isin", isin, "--order-type", order_type]
        for flag, value in (("--amount", amount), ("--shares", shares), ("--limit-price", limit_price), ("--stop-price", stop_price)):
            if value is not None and str(value).strip():
                if not DECIMAL_RE.fullmatch(str(value).strip()):
                    raise ValueError(f"{flag} must be a positive decimal, got {value!r}")
                args += [flag, str(value).strip()]
        if venue:
            if not VENUE_RE.fullmatch(venue):
                raise ValueError(f"invalid venue {venue!r}")
            args += ["--venue", venue]
        data = self._sc_run(args)
        return {
            "phase": 1,
            "order_placed": False,
            "preview": data,
            "human_confirmation_required": HUMAN_CONFIRMATION,
        }


ORDER_TYPES = {"market", "limit", "stop", "stop-limit"}
ISIN_RE = re.compile(r"[A-Z]{2}[A-Z0-9]{9}[0-9]")
DECIMAL_RE = re.compile(r"\d+(\.\d+)?")
VENUE_RE = re.compile(r"[A-Za-z]{3,8}")


def _check_isin(isin: str) -> str:
    isin = isin.strip().upper()
    if not ISIN_RE.fullmatch(isin):
        raise ValueError(f"invalid ISIN {isin!r}")
    return isin


def _result(data: Any) -> dict[str, Any]:
    result = data.get("result") if isinstance(data, dict) else None
    return result if isinstance(result, dict) else {}


def _no_name() -> tuple[Any, float]:
    raise Unavailable("no security name to search for")


def _position_view(item: dict[str, Any], total: float) -> dict[str, Any]:
    valuation = float(item.get("valuation") or 0)
    fifo, mid = item.get("fifo_price"), item.get("quote_mid_price")
    return {
        "isin": item.get("isin"),
        "name": item.get("name"),
        "kind": item.get("kind"),
        "security_type": item.get("security_type"),
        "quantity": item.get("quantity"),
        "valuation": round(valuation, 2),
        "valuation_currency": item.get("valuation_currency"),
        "weight_pct": round(valuation / total * 100, 2) if total else None,
        "quote_mid_price": mid,
        "quote_currency": item.get("quote_currency"),
        "fifo_price": fifo,
        "price_vs_fifo_pct": round((mid / fifo - 1) * 100, 2) if fifo and mid else None,
        "quote_is_outdated": item.get("quote_is_outdated"),
    }


HUMAN_CONFIRMATION = (
    "No order was placed. Present every value of preview.presentation (the CLI's mandated ex-ante "
    "disclosure) to the human, unchanged. Only the human may submit phase 2, in a separate step, by "
    "running the preview's confirmation.command_template themselves or confirming in the desktop app. "
    "This research server cannot submit orders."
)

GUIDANCE = {
    "provenance": "Each section has status/source/fetched_at. Treat status != ok as missing data, never as zero.",
    "derived": "Sections marked derived=true are computed locally from the cited source, not reported by it.",
    "freshness": "Check quote_is_outdated and fetched_at before acting on prices.",
    "execution": "Research only. Orders require a phase-1 preview and a separate human confirmation.",
}
