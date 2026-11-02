# sc-research: research data for AI agents

A data layer that gives AI agents a broad, current, **source-cited** view of a Scalable Capital
account and the securities in and around it, so they can analyse holdings and candidates. It
reads the account through the official `sc` CLI and enriches it with public sources.

It is delivered as an **MCP server** (for Claude Code, Claude Desktop or any MCP host) and as a
plain **JSON CLI** for scripts.

> **Research only.** Nothing in this package can place an order. `preview_trade` runs phase 1 of
> the CLI's two-phase trade flow and returns the mandated cost disclosure and a confirmation id.
> Phase 2 stays with the human, in a separate step, exactly as the CLI's compliance rules require
> (`forbid_automatic_phase_2_execution`).

## What agents get

| Tool | Content | Sources |
|---|---|---|
| `get_portfolio_snapshot` | valuation and returns, cash and buying power, every position with weight and price vs FIFO, concentration (top-1/top-5, Herfindahl index, mix by type), open orders, savings plans, watchlist, price alerts, overnight savings, local trade controls | `sc` |
| `get_security_dossier` | quote and performances; 1y and max-history metrics (return, annualised volatility, max drawdown, distance from high/low, SMA 20/50/200, RSI 14, CAGR); position, transactions, savings plans, alerts; Scalable news; identity; SEC fundamentals (TTM revenue, gross/operating/net margin, growth, EPS, dividends per share, cash flow, FCF, cash, debt, equity, shares) with valuation (P/E, P/S, FCF yield, dividend yield, FX-converted); recent filings and insider-filing count; worldwide news; FX | `sc`, OpenFIGI, SEC EDGAR, ECB, GDELT |
| `scan_securities` | fast triage of holdings, watchlist or a custom ISIN list: price, freshness, performances, 1y metrics | `sc` |
| `search_securities` | tradable securities by name, ticker, WKN or ISIN | `sc` |
| `get_market_context` | ECB reference FX rates and key policy rates | ECB |
| `search_global_news` | worldwide online news for any query | GDELT |
| `preview_trade` | phase-1 trade preview: disclosure, tradability, suitability, confirmation id. **No order.** | `sc` |

Two MCP prompts set the working method: `analyze_security(isin)` and `review_portfolio()`.

### Provenance contract

Every section has the same shape, so an agent can see what is missing instead of guessing:

```json
{"source": "sec-edgar:companyfacts", "status": "ok", "fetched_at": "2026-11-02T23:23:00+00:00", "data": {}}
```

`status` is one of `ok`, `unavailable` (the source has no answer for this input, for example a
company that is not an SEC filer), `rate_limited` or `error` (with the CLI's error code where
there is one). Sections computed locally carry `"derived": true`. One failing source never
hides the others.

## Sources

| Source | Data | Key | Notes |
|---|---|---|---|
| Scalable via `sc` | account, quotes, charts, news, transactions | session (`sc login`) | the CLI's own rate limits apply |
| [OpenFIGI](https://www.openfigi.com/api) | ISIN to ticker, exchange, name | optional `OPENFIGI_API_KEY` | 25 requests/min without a key |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | XBRL fundamentals (us-gaap and ifrs-full), filings | **`SEC_USER_AGENT` required** | SEC fair access: name and contact address in the User-Agent; at most 10 requests/s |
| [ECB Data Portal](https://data.ecb.europa.eu/help/api/overview) | EUR reference FX, key rates | none | |
| [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | worldwide news coverage | none | about one request every 5 seconds |

Fundamentals exist for SEC registrants: US companies (10-K/10-Q) and foreign filers (20-F/40-F,
often IFRS). The SEC registrant is found by ticker, and the company name must agree, so a ticker
collision (ALV is Allianz in Frankfurt and Autoliv on the SEC) never attaches another company's
numbers. If the ticker gives no match, an exact, unique company-name match is used instead. That
covers ADRs listed under another ticker: Novo Nordisk is NOVOB in Copenhagen and NVO on the SEC.
`matched_by` says which rule applied.

TTM figures are calculated as latest annual + current year-to-date − prior year-to-date. EPS TTM
is an additive approximation. Restated values replace earlier filings for the same period. Where
a company changed XBRL concepts over time, the concept with the most recent data is used. Facts
older than 550 days are flagged `stale` and left out of ratios and valuation.

## Setup

```bash
cd extra/research
python -m venv .venv
.venv/Scripts/pip install -e ".[mcp]"     # Windows; use .venv/bin/pip on macOS/Linux
```

The core (`snapshot`, `dossier`, `scan`, ...) uses only the standard library. The `mcp` extra is
needed only for the server.

Environment:

| Variable | Purpose |
|---|---|
| `SC_BIN` | path to `sc` if it is not on `PATH` |
| `SEC_USER_AGENT` | e.g. `"Jane Doe jane@example.com"`; without it fundamentals and filings are `unavailable` |
| `OPENFIGI_API_KEY` | optional, higher OpenFIGI limits |
| `SC_RESEARCH_CACHE_DIR` | cache location (default `%LOCALAPPDATA%\sc-research` or `~/.cache/sc-research`) |
| `SC_MOCK`, `SC_CONFIG_DIR`, … | passed through to `sc`, e.g. to run against the local mock |

### Connect an MCP host

An MCP host starts the server as a subprocess that does **not** inherit your shell environment,
so pass what `sc` and the providers need explicitly. Claude Code (`.mcp.json` in a project, or
`claude mcp add`):

```json
{
  "mcpServers": {
    "sc-research": {
      "command": "D:/scalable-cli/extra/research/.venv/Scripts/python.exe",
      "args": ["-m", "sc_research", "serve"],
      "env": {
        "SC_BIN": "D:/scalable-cli/target/release/sc.exe",
        "SEC_USER_AGENT": "Jane Doe jane@example.com",
        "APPDATA": "C:/Users/<you>/AppData/Roaming",
        "LOCALAPPDATA": "C:/Users/<you>/AppData/Local"
      }
    }
  }
}
```

On Windows `sc` finds its config and session through `APPDATA`. Add `SC_MOCK=1` and
`SC_CONFIG_DIR` to point the whole stack at the [local mock](../mock/README.md).

### JSON CLI

```bash
python -m sc_research snapshot
python -m sc_research dossier US0378331005 --sections quote price_1y fundamentals
python -m sc_research scan --universe watchlist
python -m sc_research market
python -m sc_research news '"Novo Nordisk" obesity' --days 3
```

## Caching

Responses are cached in SQLite with source-specific lifetimes: quotes 60 s, account data 60 s,
1y charts 1 h, Scalable news 15 min, GDELT 30 min, SEC filings 1 h, SEC fundamentals 12 h, FX 6 h,
FIGI mappings 30 days. Cache keys include the CLI target (`SC_MOCK`, `SC_GRAPHQL_URL`,
`SC_CONFIG_DIR`, ...), so mock and real data never mix. `--no-cache` bypasses the cache.

## Tests

```bash
.venv/Scripts/python -m unittest discover -s . -p "test_*.py" -t .
```

Offline and deterministic: provider parsers run against **real captured responses** (Apple
companyfacts and submissions from data.sec.gov, ECB CSV, OpenFIGI), and the composition runs
against `sc` output recorded from the local mock. The server tests drive the MCP server in-process.

Verified live in development: OpenFIGI, SEC `data.sec.gov`, ECB FX and key rates, and the server
over stdio against the mock backend (snapshot, watchlist scan, trade preview, market context).
**Not yet verified live:** a real GDELT article list. GDELT rate-limited the development IP
throughout, so only the rate-limit handling was observed live and the article parser follows
GDELT's documented format. Also not verified live: `www.sec.gov/files/company_tickers.json`,
which needs a real `SEC_USER_AGENT`.

## Roadmap and open decisions

This is the data foundation for agentic investing. Deliberately **not** decided without the
owner:

- **Autonomous execution.** The CLI forbids automatic phase-2 execution and requires the
  ex-ante disclosure to be presented to the client. Unattended trading would have to bypass
  that. That is a regulatory and product decision, not an implementation detail.
- **Paid or keyed data** (analyst estimates, ownership, intraday, European fundamentals, premium
  news): which vendors, at what cost, and under which licence terms. The provider layer
  (`sc_research/providers/`) is ready for more sources.
- **Where agents run**: on demand in Claude Code, scheduled routines, or the desktop app. Sessions
  expire after 24 h idle and 7 days at most, so unattended runs need periodic human login.

Natural next steps: European fundamentals (ESEF filings), dividend and corporate-action
calendars, earnings dates, peer comparison within a sector, and a persisted research journal so
agents can track how a thesis develops over time.
