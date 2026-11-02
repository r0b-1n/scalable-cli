"""MCP server exposing the research layer to AI agents (stdio transport).

Run: `python -m sc_research serve` (or `sc-research serve`). Requires the `mcp`
extra. Every tool is read-only towards the broker; `preview_trade` runs phase 1
of the CLI's two-phase trade flow and can never submit an order.
"""

from __future__ import annotations

from typing import Any, Literal

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from .research import ALL_SECTIONS, Research
from .sc import ScError

INSTRUCTIONS = """\
Research tools for a Scalable Capital broker account, backed by the official `sc` CLI plus public
sources (OpenFIGI, SEC EDGAR, ECB, GDELT).

How to use the data:
- Every section carries status, source and fetched_at. status other than "ok" means the data is
  missing; say so instead of guessing or treating it as zero.
- derived=true sections are computed locally from the cited source (e.g. volatility from chart data).
- Prices can be stale: check quote_is_outdated and fetched_at.
- Fundamentals exist only for SEC registrants (US companies and foreign SEC filers).

Execution rules (non-negotiable):
- These tools never place orders. preview_trade only runs phase 1 and returns the CLI's mandated
  ex-ante cost disclosure plus a confirmation id.
- Present the whole disclosure to the human unchanged. Only the human may submit phase 2, in a
  separate step, outside this server.
"""

mcp = MCPServer("sc-research", instructions=INSTRUCTIONS)
_research: Research | None = None

READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True)


def research() -> Research:
    global _research
    if _research is None:
        _research = Research()
    return _research


def _call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except ScError as exc:
        hints = f" Hints: {'; '.join(exc.hints)}" if exc.hints else ""
        raise ToolError(f"sc {exc.code}: {exc.message}.{hints}") from exc
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


@mcp.tool(annotations=READ)
def get_portfolio_snapshot() -> dict[str, Any]:
    """Whole-account view: valuation and returns, cash and buying power, every position with weight
    and price vs. FIFO cost, concentration (top-1/top-5 weight, Herfindahl index, mix by security
    type), open orders, savings plans, watchlist, price alerts, overnight savings and the local trade
    controls that will constrain any order. Start here."""
    return _call(research().portfolio_snapshot)


DOSSIER_DESCRIPTION = (
    "Everything known about one security, each part with provenance: live quote and multi-period "
    "performance; 1y and max-history metrics (return, annualised volatility, max drawdown, distance "
    "from high/low, SMA 20/50/200, RSI 14, CAGR); the account's position, transactions, savings plans "
    "and price alerts for it; Scalable news; identity (ticker, exchange via OpenFIGI); SEC fundamentals "
    "(TTM revenue, margins, growth, EPS, cash flow, balance sheet) with valuation multiples (P/E, P/S, "
    "FCF yield, FX-converted); recent SEC filings and insider-filing count; worldwide news (GDELT); "
    "ECB FX rates. Pass `sections` to limit the work; valid: " + ", ".join(ALL_SECTIONS)
)


@mcp.tool(annotations=READ, description=DOSSIER_DESCRIPTION)
def get_security_dossier(
    isin: str,
    sections: list[str] | None = None,
    news_locale: Literal["en_DE", "de_DE"] = "en_DE",
    news_days: int = 7,
) -> dict[str, Any]:
    return _call(research().security_dossier, isin, sections, news_locale=news_locale, news_days=max(1, min(news_days, 90)))


@mcp.tool(annotations=READ)
def scan_securities(
    universe: Literal["holdings", "watchlist", "custom"] = "holdings",
    isins: list[str] | None = None,
) -> dict[str, Any]:
    """Fast triage across many securities: price, quote freshness, Scalable performances and 1y
    metrics (return, volatility, distance from high, RSI, trend vs SMA 50/200, max drawdown) for every
    holding, every watchlist entry, or a custom ISIN list (universe="custom" + isins). Use it to pick
    candidates, then get_security_dossier for depth."""
    r = research()
    if universe == "custom":
        if not isins:
            raise ToolError("universe='custom' needs a non-empty isins list")
        targets = isins
    else:
        targets = _call(r.universe, universe)
    if len(targets) > 100:
        raise ToolError("at most 100 securities per scan")
    return _call(r.scan, targets)


@mcp.tool(annotations=READ)
def search_securities(query: str) -> dict[str, Any]:
    """Find tradable securities on Scalable by name, ticker, WKN or ISIN (`sc broker search`)."""
    if not query.strip() or len(query) > 200:
        raise ToolError("query must be 1-200 characters")
    return _call(lambda: research()._sc_run(["broker", "search", query.strip()]))


@mcp.tool(annotations=READ)
def get_market_context() -> dict[str, Any]:
    """Macro backdrop from the ECB: euro reference FX rates (USD, GBP, CHF, JPY, CNY, with day
    change) and the key policy rates (deposit facility, main refinancing, marginal lending)."""
    return _call(research().market_context)


@mcp.tool(annotations=READ)
def search_global_news(query: str, days: int = 7, max_records: int = 25) -> dict[str, Any]:
    """Worldwide online news coverage via GDELT for any query (company, sector, theme, person).
    Wrap exact phrases in double quotes. GDELT allows about one request every 5 seconds."""
    if not query.strip() or len(query) > 300:
        raise ToolError("query must be 1-300 characters")
    return _call(research().news_global, query.strip(), max(1, min(days, 90)), max(1, min(max_records, 100)))


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=False, open_world_hint=True))
def preview_trade(
    side: Literal["buy", "sell"],
    isin: str,
    order_type: Literal["market", "limit", "stop", "stop-limit"] = "market",
    amount: str | None = None,
    shares: str | None = None,
    limit_price: str | None = None,
    stop_price: str | None = None,
    venue: str | None = None,
) -> dict[str, Any]:
    """Phase 1 of a trade: validates the order with the CLI and returns its mandated ex-ante cost
    disclosure, tradability, suitability and a short-lived confirmation id. NO ORDER IS PLACED.
    Buy needs exactly one of amount (EUR) or shares (whole); sell needs shares. Local trade controls
    apply. Present the full disclosure to the human; only they can submit phase 2, separately."""
    return _call(
        research().preview_trade,
        side,
        isin,
        amount=amount,
        shares=shares,
        order_type=order_type,
        limit_price=limit_price,
        stop_price=stop_price,
        venue=venue,
    )


@mcp.prompt()
def analyze_security(isin: str) -> str:
    """Structured, source-cited analysis of one security from the account holder's perspective."""
    return f"""Analyse the security {isin} for this account.

1. Call get_security_dossier(isin="{isin}") and get_portfolio_snapshot().
2. Report, citing the section and fetched_at for every figure:
   - Business and identity; data gaps (every section whose status is not "ok").
   - Price behaviour: 1y/max return, volatility, max drawdown, trend vs SMA 50/200, RSI.
   - Fundamentals and valuation if available: growth, margins, cash flow, balance sheet, P/E, P/S, FCF yield.
   - News and filings: what changed recently, from Scalable news, GDELT and SEC filings.
   - Fit with the portfolio: current weight, concentration effect, savings plans, alerts.
3. Give a bull case, a bear case and the key risks, then a clearly labelled opinion with your confidence.
4. If you suggest a trade, call preview_trade and show its full disclosure. Never claim an order was
   placed: only the human can submit phase 2, separately.
Distinguish reported data from your own inference. Do not fill gaps with assumptions."""


@mcp.prompt()
def review_portfolio() -> str:
    """Portfolio health check: allocation, concentration, laggards and data-backed follow-ups."""
    return """Review this portfolio.

1. Call get_portfolio_snapshot() and scan_securities(universe="holdings"); optionally
   scan_securities(universe="watchlist") and get_market_context().
2. Report allocation and concentration (top-1/top-5 weight, Herfindahl index, security-type mix),
   cash and buying power, open orders, savings plans and the local trade controls in force.
3. Flag positions with notable drawdown, weak trend (below SMA 200), extreme RSI or stale quotes,
   and call get_security_dossier for the two or three most relevant ones.
4. Propose concrete, prioritised follow-ups with reasoning and sources. Any trade idea goes through
   preview_trade and stays a proposal until the human submits phase 2 themselves.
Cite section and fetched_at for figures; say plainly where data is missing."""


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
