# Scalable Mock Backend

Full-fidelity local mock for `scalable-cli` — lets you test the *real* user flow offline, without a live Scalable account.

Run the CLI against this mock exactly like against the official platform (`https://de.scalable.capital/api/cli/graphql` + `https://secure.scalable.capital`).

## What it covers

- **Auth:** device-code (`/oauth/device/code` → `/oauth/token` poll), refresh, revoke, OIDC discovery (`/.well-known/openid-configuration` + `/jwks`), `RS256` JWTs, DPoP (lenient), 2FA stubs
- **Broker reads:** `overview`, `analytics`, `cash-breakdown`, `holdings`, `watchlist`, `search`, `derivatives search`, `quote`, `chart`, `security-news`, `price-alerts` (+crypto), `transactions` (+fingerprint), `transaction details`, `portfolio-groups`, `savings-plans`, `overnight` (`DiscoverOvernightAccounts` / `OvernightSummary` / `OvernightTransactions`)
- **Broker writes:** `watchlist add/remove`, `price-alerts add/remove`, `savings-plans add/config/remove` (2-phase `scsp1_` with locks), `portfolio-groups create/update/delete/assign/unassign`
- **Trading:** `getTradingTradability` → `getSecurityTick` → `getSingleTradeExAnteCost` (+ `getBrokerAppropriatenessWarning` / `createFillForecast`) → `placeOrder` with `X-SC-Idempotency-Id` → `cancelOrder` (`scb1_` confirmations, `900s` TTL, checksum validation)
- Deterministic fixtures (Apple `US0378331005`, iShares `IE00B4L5Y983`, Tesla `US88160R1014`, etc.), pagination, filtering, sorting

All responses match the projections in `src/broker_projections.rs` / `src/trade.rs` so `sc --json` output is identical in shape to production.

## Quick start

```powershell
# 1. Build mock
cargo build --manifest-path extra/mock/Cargo.toml

# 2. Run mock (in one terminal)
extra/mock/target/debug/scalable-mock --port 4010
# -> issuer: http://127.0.0.1:4010
#    graphql: http://127.0.0.1:4010/graphql

# 3. Run CLI against mock (in another terminal) with isolated config
$env:SC_MOCK="1"                    # shorthand for http://127.0.0.1:4010
# or explicit:
# $env:SC_GRAPHQL_URL="http://127.0.0.1:4010/graphql"
# $env:SC_OAUTH_ISSUER="http://127.0.0.1:4010"
$env:SC_CONFIG_DIR="D:\temp\sc-mock"
cargo run --bin sc -- login         # device-code poll auto-approves after 2 polls
cargo run --bin sc -- whoami --json
cargo run --bin sc -- broker overview --json
cargo run --bin sc -- broker holdings --json
cargo run --bin sc -- broker trade buy --isin US0378331005 --amount 500 --json        # preview -> scb1_...
cargo run --bin sc -- broker trade buy --isin US0378331005 --amount 500 --confirm scb1_... --json
```

For release binaries `SC_CONFIG_DIR` is now honored in all builds (`src/config.rs`), and plain-`http` transport is allowed **only to loopback hosts** (`src/transport_security.rs`, `src/channel.rs`).

If the login step fails with "OS secret storage … is unavailable" (headless machines, containers), store the mock session in a file instead — add to `$SC_CONFIG_DIR/config.toml`:

```toml
[auth]
session_backend = "file"
```

## Security model

- The env override never weakens transport security against real hosts: every endpoint URL (`graphql_url`, issuer, discovery/JWKS URLs) must be `https`, or `http` **to a loopback host** (`localhost`, `127.0.0.0/8`, `::1`). Plain `http` to anything else is rejected before a request is sent.
- The CLI's HTTP client stays HTTPS-only unless the override resolves to a loopback-http setup; in that mode HTTP redirects are disabled entirely, so the mock cannot bounce the client to another destination.
- Whenever `SC_MOCK`/`SC_GRAPHQL_URL` is active, the CLI prints a one-time `warning:` banner to stderr naming the endpoint and issuer, so a leftover env var can't silently redirect a shell.
- The mock binds to `127.0.0.1` by default and warns loudly when bound to a non-loopback address: it has **no real authentication** (the device flow auto-approves after two polls) and serves fixture data to anyone who can reach it. Never point it at real credentials or expose it beyond your machine.
- Device codes are single-use; the signing key is a fresh in-memory RSA-2048 key per process.

## Env vars

| var | default | description |
|-----|---------|-------------|
| `SC_MOCK` | off | `1/true/yes/on` → use `http://127.0.0.1:{SC_MOCK_PORT}/graphql` |
| `SC_MOCK_PORT` | `4010` | port for `SC_MOCK` shorthand |
| `SC_GRAPHQL_URL` | — | explicit GraphQL URL (overrides `SC_MOCK`); `https`, or `http` to loopback only |
| `SC_OAUTH_ISSUER` | `http://127.0.0.1:4010` | OIDC issuer; `https`, or `http` to loopback only |
| `SC_OAUTH_AUDIENCE` | `https://de.scalable.capital/api-gateway` | audience |
| `SC_OAUTH_CLIENT_ID` | `yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE` | client id |
| `SC_CONFIG_DIR` | platform default | isolated config dir (now works in release) |

## Why extra/ ?

Kept fully isolated under `extra/mock` so the main crate stays lean. No workspace pollution, easy to run via `cargo run -p scalable-mock` or as a standalone binary.

## Tech

- Rust + Axum + Tokio
- RSA 2048 key generated at startup, `/.well-known/openid-configuration` + `/jwks` for `RS256` verification (`src/token_verifier.rs`)
- In-memory `MockState` (`state.rs`) with `RwLock`, deterministic fixtures
- GraphQL dispatcher (`graphql.rs`) by `operationName` / query substring
