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

For release binaries `SC_CONFIG_DIR` is now honored in all builds (patched `src/config.rs`), and `http` loopback is allowed when `SC_MOCK` is set (`src/transport_security.rs`, `src/channel.rs`).

## Env vars

| var | default | description |
|-----|---------|-------------|
| `SC_MOCK` | off | `1/true/yes/on` → use `http://127.0.0.1:{SC_MOCK_PORT}/graphql` |
| `SC_MOCK_PORT` | `4010` | port for `SC_MOCK` shorthand |
| `SC_GRAPHQL_URL` | — | explicit GraphQL URL (overrides `SC_MOCK`) |
| `SC_OAUTH_ISSUER` | `http://127.0.0.1:4010` | OIDC issuer |
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
