//! Mock chat-completion backend shared by the four provider adapters (`llm::anthropic`,
//! `llm::openai`, `llm::google`, `llm::ollama`).
//!
//! Real providers speak four different wire formats, but underneath there is exactly one thing
//! going on: a conversation history goes in, and either a tool call or a final message comes out.
//! Every adapter's job is purely translation — parse its own request body into the neutral
//! [`Turn`] history below, call [`next_action`] to find out what the emulated model does next, and
//! render the resulting [`ModelAction`] back into its own response shape. None of the "what does
//! the model do" logic lives in an adapter; all of it lives here, in [`decide_next_step`], so it
//! is exercised identically no matter which wire format a test happens to be driving.
//!
//! Determinism is mandatory: the same seed plus the same conversation must always produce the
//! same tool calls and the same final proposal, with no clock or OS-randomness anywhere in the
//! decision path. [`decide_next_step`] reuses the crate's existing seeded xoshiro256** generator
//! (`crate::rng::Rng`) exactly as `pricing.rs` does, rather than inventing a second PRNG.

pub mod anthropic;
pub mod google;
pub mod ollama;
pub mod openai;

use crate::catalog;
use crate::rng::Rng;
use anyhow::{Context, Result};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

/// One neutral turn in a conversation, independent of any provider's wire format. Each adapter
/// builds a `Vec<Turn>` out of its own request body before calling [`next_action`].
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Turn {
    System(String),
    User(String),
    Assistant { text: Option<String>, tool_calls: Vec<ToolCallRequest> },
    /// The result of one prior tool call, appended as an inert message — never parsed as an
    /// instruction (mirrors Invariant AG-2's "tool results are data, not instructions").
    ToolResult { name: String, content: Value },
}

/// A tool call as the (emulated) model asked for it, independent of wire format.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCallRequest {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// What the emulated model does next, translated from a [`NextStep`] decision into the one shape
/// every adapter actually needs to render: either a single tool call or a final text message.
/// (Real providers only ever return one tool call per turn in this agentic-loop style, and so
/// does every mock response — matching the "call a tool, wait for its result" idiom the real run
/// loop drives.)
pub enum ModelAction {
    ToolCall { name: String, arguments: Value },
    Text(String),
}

/// The three shapes a deterministic decision can take. `ProposeTrade` is deliberately narrower
/// than the real `propose_trade` tool schema (§6.1) — it carries only the fields the RNG path
/// derives (`isin`, `side`, `amount`); [`resolve_action`] fills in the rest (`order_type`,
/// `rationale`) with fixed values. A scripted turn that names `propose_trade` supplies the full
/// argument object itself and is carried through as an ordinary `CallTool` instead, so
/// `--llm-script` scenarios keep full control over every field (including deliberately invalid
/// ones, for policy-rejection tests).
pub(crate) enum NextStep {
    CallTool { name: String, args: Value },
    ProposeTrade { isin: String, side: String, amount: String },
    FinalText(String),
}

/// Shared, in-memory state for the emulated model layer. This is intentionally a third field on
/// `AppState`, separate from `MockState` (which stays scoped to the brokerage-fixture domain).
pub struct AiState {
    pub seed: u64,
    pub next_completion_id: u64,
    pub script: Option<Script>,
    pub require_provider_auth: bool,
}

pub type SharedAi = Arc<RwLock<AiState>>;

impl AiState {
    pub fn new(seed: u64, script: Option<Script>, require_provider_auth: bool) -> Self {
        AiState { seed, next_completion_id: 0, script, require_provider_auth }
    }

    /// Mint the next monotonic id. Every adapter formats this into its own convention
    /// (`chatcmpl-{n}`, `msg_{n}`, `toolu_{n}`, `call_{n}`, ...) — mirroring the crate's existing
    /// `order-{n}`/`group-{n}` idiom — rather than ever generating a random UUID.
    pub fn next_id(&mut self) -> u64 {
        self.next_completion_id += 1;
        self.next_completion_id
    }
}

/// `--llm-script <path>` file contents (§10.5): a fixed sequence of per-turn responses served in
/// order instead of the RNG decision path, so a specific scenario can be driven without depending
/// on probability.
#[derive(Debug, Clone, Deserialize)]
pub struct Script {
    pub turns: Vec<ScriptedTurn>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptedTurn {
    #[serde(default)]
    pub tool_calls: Vec<ScriptedToolCall>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScriptedToolCall {
    pub name: String,
    pub arguments: Value,
}

/// Load a `--llm-script` file. Called once at startup; a malformed script is a startup error, not
/// something that surfaces mid-run as a confusing mock response.
pub fn load_script(path: &Path) -> Result<Script> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read --llm-script file '{}'", path.display()))?;
    serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse --llm-script file '{}' as JSON", path.display()))
}

/// The one entry point every provider adapter calls: given the conversation so far and the tool
/// names this request declared, decide what the model does next. Handles both the scripted path
/// (`AiState.script` present) and the deterministic RNG path uniformly, so an adapter never has
/// to know which one is active.
pub fn next_action(ai: &mut AiState, history: &[Turn], tools_offered: &[String]) -> ModelAction {
    let turn_index = tool_round_trips(history);
    let step = match &ai.script {
        Some(script) => scripted_step(script, turn_index as usize),
        None => {
            let key = conversation_key(turn_index, history);
            decide_next_step(ai.seed, &key, tools_offered)
        }
    };
    resolve_action(step)
}

/// Number of prior tool round-trips already in the conversation (one [`Turn::ToolResult`] per
/// completed call) — both the scripted path's turn index and, embedded in [`conversation_key`],
/// the RNG path's "have I gathered enough context yet" counter.
fn tool_round_trips(history: &[Turn]) -> u32 {
    history.iter().filter(|t| matches!(t, Turn::ToolResult { .. })).count() as u32
}

/// Serialize the whole neutral history into the string [`decide_next_step`] hashes against, so
/// byte-identical requests (same seed, same messages, same tools) always produce byte-identical
/// mock replies — mirrors `pricing.rs`'s `Rng::for_key(seed, &format!("{isin}|current|{day}"))`
/// idiom. The turn count is embedded as a plain prefix rather than re-derived by counting
/// substrings in the serialized form, since `decide_next_step` only ever sees the string.
fn conversation_key(turn_index: u32, history: &[Turn]) -> String {
    let serialized = serde_json::to_string(history).unwrap_or_default();
    format!("{turn_index}:{serialized}")
}

/// Deterministic policy: for a stable number of turns (derived from `tools_offered`, which is the
/// one part of the request that never changes across a conversation, unlike the growing message
/// history), request a tool that the request itself declared in `tools_offered` — never a name
/// the caller didn't offer, so the tool allowlist is what actually bounds behavior, not the mock.
/// Once "satisfied", emit either a deterministic `propose_trade` decision (for a real ISIN drawn
/// from `catalog.rs`'s static instrument list) or a deterministic "no action" final text.
pub(crate) fn decide_next_step(seed: u64, conversation_key: &str, tools_offered: &[String]) -> NextStep {
    let turns_so_far: u32 = conversation_key
        .split_once(':')
        .and_then(|(n, _)| n.parse().ok())
        .unwrap_or(0);

    // Everything that must stay stable for the life of one conversation (which instrument, which
    // side, how much, how many read-only turns before proposing) is drawn from a key built only
    // from `tools_offered` — not from `conversation_key`, which grows every turn as more tool
    // results are appended and so would reshuffle these choices turn to turn if used directly.
    let mut plan_rng = Rng::for_key(seed, &format!("plan|{}", tools_offered.join(",")));

    let equities: Vec<&catalog::Instrument> =
        catalog::catalog().iter().filter(|i| !i.is_derivative).collect();
    let instrument = equities[plan_rng.range_i64(0, equities.len() as i64 - 1) as usize];
    let total_tool_turns = 1 + plan_rng.range_i64(0, 1) as u32; // 1 or 2 read-only turns first
    let side = if plan_rng.chance(0.5) { "buy" } else { "sell" };
    let amount = format!("{:.2}", plan_rng.range(500.0, 4000.0));
    let should_propose = plan_rng.chance(0.7);

    if turns_so_far < total_tool_turns {
        let name = pick_tool_name(tools_offered, turns_so_far);
        let args = tool_args_for(&name, instrument);
        return NextStep::CallTool { name, args };
    }

    if should_propose {
        NextStep::ProposeTrade { isin: instrument.isin.to_string(), side: side.to_string(), amount }
    } else {
        NextStep::FinalText(format!(
            "Reviewed {} ({}) against current market conditions; no trade is warranted this run.",
            instrument.name, instrument.isin
        ))
    }
}

/// Pick the `turns_so_far`-th tool (in a fixed preference order) that this request actually
/// declared in `tools_offered`, falling back to the first non-`propose_trade` tool offered, and
/// finally to `"quote"` if the request offered nothing at all recognizable. Never returns a name
/// absent from `tools_offered` unless `tools_offered` itself is empty.
fn pick_tool_name(tools_offered: &[String], turns_so_far: u32) -> String {
    const PREFERRED_ORDER: [&str; 12] = [
        "quote",
        "chart",
        "overview",
        "analytics",
        "holdings",
        "security_news",
        "transactions",
        "watchlist",
        "cash_breakdown",
        "portfolio_groups",
        "search",
        "derivatives_search",
    ];
    PREFERRED_ORDER
        .iter()
        .filter(|candidate| tools_offered.iter().any(|t| t == *candidate))
        .nth(turns_so_far as usize)
        .map(|s| s.to_string())
        .or_else(|| tools_offered.iter().find(|t| t.as_str() != "propose_trade").cloned())
        .unwrap_or_else(|| "quote".to_string())
}

/// Build a plausible argument object for a chosen read-only tool, anchored on `instrument` so the
/// whole conversation stays about one real ISIN.
fn tool_args_for(name: &str, instrument: &catalog::Instrument) -> Value {
    match name {
        "quote" | "security_news" | "derivatives_search" => json!({ "isin": instrument.isin }),
        "chart" => json!({ "isin": instrument.isin, "timeframe": "3m" }),
        "search" => json!({ "query": instrument.name }),
        _ => json!({}),
    }
}

/// Look up the scripted response for one turn index. Running past the end of `script.turns`
/// yields an empty final text rather than panicking, so a short script still exercises "the model
/// stops on its own" without every test needing to script a trailing no-op turn.
fn scripted_step(script: &Script, turn_index: usize) -> NextStep {
    let Some(turn) = script.turns.get(turn_index) else {
        return NextStep::FinalText(String::new());
    };
    match turn.tool_calls.first() {
        Some(call) => NextStep::CallTool { name: call.name.clone(), args: call.arguments.clone() },
        None => NextStep::FinalText(turn.text.clone().unwrap_or_default()),
    }
}

/// Turn a [`NextStep`] into the one thing every adapter renders: a tool call or final text.
/// `ProposeTrade` is expanded into the full `propose_trade` argument object here (order type
/// fixed to `"market"`, rationale a fixed template) so this expansion happens exactly once,
/// shared by all four wire formats, rather than once per adapter.
fn resolve_action(step: NextStep) -> ModelAction {
    match step {
        NextStep::CallTool { name, args } => ModelAction::ToolCall { name, arguments: args },
        NextStep::ProposeTrade { isin, side, amount } => ModelAction::ToolCall {
            name: "propose_trade".to_string(),
            arguments: json!({
                "side": side,
                "isin": isin,
                "order_type": "market",
                "amount": amount,
                "rationale": format!(
                    "Mock proposal: {side} {amount} (account currency) of {isin} based on the market data gathered this run."
                ),
            }),
        },
        NextStep::FinalText(text) => ModelAction::Text(text),
    }
}

/// Wire the six mock-LLM routes (§10.1) onto a router that already carries `crate::AppState`,
/// leaving the caller free to add its own routes before or after and to `.fallback(...)`/
/// `.with_state(...)` as usual. Every handler is written directly against `State<AppState>` (the
/// `root_handler` pattern) rather than through the legacy `handle_*_combined` wrapper indirection
/// `graphql.rs`/`auth.rs` use, since there is no pre-`AppState` history here to stay compatible
/// with.
pub fn add_routes(router: Router<crate::AppState>) -> Router<crate::AppState> {
    router
        .route("/v1/messages", post(anthropic::messages))
        .route("/v1/chat/completions", post(openai::chat_completions))
        .route("/v1/models", get(openai::list_models))
        .route("/v1beta/models/:model_and_action", post(google::generate_content))
        .route("/api/chat", post(ollama::chat))
        .route("/api/tags", get(ollama::list_models))
}

/// Shared error-scenario handling for all four adapters (§10.4), checked before any decision
/// logic runs. A magic model name always wins, regardless of auth, so a rate-limit/error scenario
/// never has to also stand up a fake credential; otherwise a missing provider credential is
/// rejected when the mock was started with `--require-provider-auth`. These are real REST
/// provider APIs (auth.rs's one-handler-per-endpoint / real-status-code convention), deliberately
/// not graphql.rs's always-200-errors-as-data convention.
pub fn provider_error_response(
    headers: &HeaderMap,
    model: &str,
    require_auth: bool,
) -> Option<(StatusCode, Value)> {
    if model == "rate-limited-test-model" {
        return Some((
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "error": { "type": "rate_limit_error", "message": "mock backend: rate limited" } }),
        ));
    }
    if model == "error-test-model" {
        return Some((
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": { "type": "api_error", "message": "mock backend: internal error" } }),
        ));
    }
    if require_auth {
        let has_credential = headers.contains_key("x-api-key")
            || headers.contains_key("authorization")
            || headers.contains_key("x-goog-api-key");
        if !has_credential {
            return Some((
                StatusCode::UNAUTHORIZED,
                json!({ "error": { "type": "authentication_error", "message": "mock backend: missing provider credential" } }),
            ));
        }
    }
    None
}

/// Extract tool names from the shape OpenAI and Ollama share on the wire:
/// `[{"type":"function","function":{"name":...}}]`.
pub fn function_tool_names(tools: Option<&Value>) -> Vec<String> {
    tools
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| t.get("function").and_then(|f| f.get("name")).and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}
