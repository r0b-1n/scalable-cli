<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../docs/assets/sc-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="../docs/assets/sc-woodsmoke.svg">
    <img src="../docs/assets/sc-woodsmoke.svg" alt="Scalable" width="80">
  </picture>
</p>

<h1 align="center">Scalable Desktop</h1>

<p align="center"><strong>A desktop window onto the Scalable CLI.</strong></p>

Scalable Desktop is a Tauri app that drives the `sc` binary. It does not talk to the Scalable
API itself: every screen runs a real `sc … --json` command through the bundled CLI and renders
the result. Anything the app can do, you can do in a terminal — and the app shows you how.

## Principles

1. **The CLI is the product.** Every screen can show the exact `sc` command behind its data, and
   the CLI console keeps a log of everything the app ran this session.
2. **Two-phase writes stay two-phase.** Trades and savings-plan changes always render the CLI's
   complete ex-ante cost disclosure and require a separate, explicit confirmation before phase 2.
   The app never auto-submits.
3. **Nothing is invented client-side.** Views that combine several commands are labelled as
   derived, and say which commands they combine.

## Screens

| Area | Route | Commands |
|---|---|---|
| Dashboard | `/` | `broker overview`, `cash-breakdown`, `holdings`, `transactions`, `overnight` |
| Positions | `/portfolio` | `broker holdings` (+ `--include-year-to-date`) |
| Groups | `/groups` | `broker portfolio-groups` + `create/update/delete/assign/unassign` |
| Analytics | `/analytics` | `broker analytics` |
| Rebalancing | `/rebalancing` | `broker holdings` + `trade buy/sell` (preview) |
| Orders | `/orders` | `broker transactions --status …`, `trade cancel`, `transaction details` |
| Derivatives | `/derivatives` | `broker derivatives search` (every filter), `quote`, `chart` |
| Savings plans | `/savings-plans` | `broker savings-plans` + `config` + `add` (two-phase) + `remove` |
| Overnight | `/overnight` | `overnight`, `overnight transactions` |
| Watchlist | `/watchlist` | `broker watchlist` + `add`/`remove`, `price-alerts add` |
| Price alerts | `/price-alerts` | `broker price-alerts` + `add`/`remove` |
| Transactions | `/transactions` | `broker transactions` (every filter), `transaction details` |
| Income report | `/reports/income` | `broker transactions`, `overnight transactions` |
| Cost report | `/reports/costs` | `broker transactions`, `broker transaction details` |
| Security | `/security/:isin` | `broker quote`, `chart`, `security-news`, `transactions`, `holdings` |
| Settings | `/settings` | `broker context show/list/select`, `capabilities`, `whoami` |
| CLI console | `/cli` | `capabilities` + the session command log |

Composite views — rebalancing, the income and cost reports, group-level P&L, the savings-plan
simulator and the all-cash overview — are computed locally from several commands. They are marked
as derived in the UI.

## Keyboard

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ K` | Search securities |
| `Ctrl/⌘ ⇧ P` | Command palette (jump to a screen, start an action) |
| `Esc` | Close the open dialog |

## Develop

```bash
cd desktop
npm install
npm run sidecar     # builds `sc` in release mode and stages it as the Tauri sidecar
npm run tauri dev
```

`npm run sidecar` is required at least once: the app resolves `sc` next to its own executable, so
the binary has to be staged at `src-tauri/binaries/sc-<target-triple>` before a dev or bundle run.

Type-check and build the frontend on its own:

```bash
npm run build       # tsc && vite build
```

## Run against the local mock backend

The repo ships a full local mock of the Scalable API, so the app can be exercised without a real
account. Start it, point the CLI at it, then launch the app from the same shell:

```bash
cargo build --manifest-path ../extra/mock/Cargo.toml
../extra/mock/target/debug/scalable-mock --port 4010 &

export SC_MOCK=1
export SC_CONFIG_DIR=/tmp/sc-mock          # keep the mock session out of your real config
mkdir -p "$SC_CONFIG_DIR"
printf '[auth]\nsession_backend = "file"\n' > "$SC_CONFIG_DIR/config.toml"   # headless machines

../target/release/sc login                 # the device flow auto-approves after two polls
npm run tauri dev
```

See `../extra/mock/README.md` for the mock's fixtures and its security model. The mock binds to
loopback, has no real authentication, and must never be pointed at real credentials.

## Architecture

```
src/
  api/client.ts      every sc command, typed; logs each call for the CLI console
  api/types.ts       the --json payload contracts
  lib/cliLog.ts      reconstructs the `sc …` command line behind each IPC call
  lib/theme.ts       system / light / dark preference
  components/ui/     design-system primitives (DataTable, Toast, Skeleton, CliCommand, …)
  components/<area>/ one directory per screen
src-tauri/
  src/sc.rs          locates and runs the sidecar, unwraps the machine envelope
  src/validate.rs    input validation at the IPC trust boundary
  src/commands/      one #[tauri::command] per CLI command
```

The webview is locked down by CSP: no remote origins, no inline scripts, and no network access of
its own — every call goes through Tauri to the `sc` process. `validate.rs` re-checks every string
the webview sends before it becomes an argv entry, so a compromised renderer cannot drive
arbitrary CLI shapes.

## Theming

Colours are defined once as `--sc-*` custom properties in `src/styles.css` and exposed to Tailwind
as theme tokens. Light and dark are complete palettes of the same roles — components never
hardcode a colour, and charts read the live CSS variables through `lib/chartTheme.ts`, so both
themes stay correct without a second copy of the palette.
