mod auth;
mod catalog;
mod fixtures;
mod graphql;
mod llm;
mod pricing;
mod rng;
mod state;

use auth::{AuthState, SharedAuth};
use axum::{
    extract::Request,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use clap::Parser;
use llm::{AiState, SharedAi};
use serde_json::json;
use state::{MockState, SharedState};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser, Debug)]
#[command(name = "scalable-mock", about = "Full-fidelity mock backend for scalable-cli")]
struct Args {
    #[arg(long, default_value = "4010")]
    port: u16,
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    /// Deterministic dataset seed. Same seed (and roughly the same day) => same generated
    /// portfolios/transactions/prices. Defaults to a fixed constant so a plain run is
    /// reproducible without having to remember to pass `--seed`.
    #[arg(long, default_value_t = DEFAULT_SEED)]
    seed: u64,
    /// Path to a JSON script of pinned, per-turn-index LLM responses (§10.5). When present, the
    /// mock's `/v1/messages`, `/v1/chat/completions`, `:generateContent`, and `/api/chat` routes
    /// serve turns from this file instead of the deterministic RNG decision path, so a specific
    /// scenario can be driven without depending on probability.
    #[arg(long)]
    llm_script: Option<PathBuf>,
    /// Reject LLM-route requests that carry no recognized provider credential header with a 401,
    /// instead of the default leniency of serving a response regardless.
    #[arg(long, default_value_t = false)]
    require_provider_auth: bool,
}

/// Fixed default so `scalable-mock` with no `--seed` flag is still fully reproducible.
const DEFAULT_SEED: u64 = 20_260_913;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();
    let addr = format!("{}:{}", args.host, args.port);
    let socket_addr: SocketAddr = addr.parse()?;

    if !socket_addr.ip().is_loopback() {
        eprintln!(
            "WARNING: binding to non-loopback address {} — the mock has no real authentication \
             (device flow auto-approves) and will serve fixture data to anyone who can reach it.",
            socket_addr.ip()
        );
    }

    let issuer = format!("http://{}:{}", args.host, args.port);
    let graphql_url = format!("http://{}:{}/graphql", args.host, args.port);
    let audience = "https://de.scalable.capital/api-gateway".to_string();
    let client_id = "yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE".to_string();

    let mock_state: SharedState = Arc::new(RwLock::new(MockState::new(args.seed, Utc::now())));
    let auth_state: SharedAuth = Arc::new(RwLock::new(AuthState::new(
        issuer.clone(),
        audience.clone(),
        client_id.clone(),
    )));
    let llm_script = args
        .llm_script
        .as_deref()
        .map(llm::load_script)
        .transpose()?;
    let ai_state: SharedAi = Arc::new(RwLock::new(AiState::new(
        args.seed,
        llm_script,
        args.require_provider_auth,
    )));

    println!("Scalable Mock Backend");
    println!("  issuer:      {}", issuer);
    println!("  graphql_url: {}", graphql_url);
    println!("  audience:    {}", audience);
    println!("  seed:        {}", args.seed);
    println!("  client_id:   {}", client_id);
    println!("  listening:   http://{}", addr);
    println!();
    println!("Configure scalable-cli to use this mock:");
    println!("  $env:SC_MOCK=\"1\"            # enables http + mock issuer");
    println!("  $env:SC_MOCK_PORT=\"{}\"      # optional, default 4010", args.port);
    println!("  $env:SC_CONFIG_DIR=\"/tmp/sc-mock\" # isolated config");
    println!("  cargo run -- --help");
    println!();

    let combined_state = AppState {
        mock: mock_state,
        auth: auth_state,
        ai: ai_state,
    };

    let app_with_combined = llm::add_routes(
        Router::new()
            .route("/", get(root_handler))
            .route("/graphql", post(handle_graphql_combined))
            .route("/api/cli/graphql", post(handle_graphql_combined))
            .route("/oauth/device/code", post(handle_device_code_combined))
            .route("/oauth/token", post(handle_token_combined))
            .route("/oauth/revoke", post(handle_revoke_combined))
            .route("/.well-known/openid-configuration", get(handle_openid_combined))
            .route("/jwks", get(handle_jwks_combined))
            .route("/.well-known/oauth-authorization-server", get(handle_openid_combined))
            .route("/authorize", get(auth::authorize_handler))
            .route("/device", get(auth::device_page_handler)),
    )
    .fallback(fallback_handler)
    .with_state(combined_state);

    let listener = tokio::net::TcpListener::bind(socket_addr).await?;
    axum::serve(listener, app_with_combined).await?;
    Ok(())
}

#[derive(Clone)]
pub(crate) struct AppState {
    mock: SharedState,
    auth: SharedAuth,
    pub(crate) ai: SharedAi,
}

async fn handle_graphql_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    body: Json<serde_json::Value>,
) -> impl IntoResponse {
    graphql::graphql_handler(axum::extract::State(state.mock), headers, body).await
}

async fn handle_device_code_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    form: axum::extract::Form<auth::DeviceCodeForm>,
) -> impl IntoResponse {
    auth::device_code_handler(axum::extract::State(state.auth), headers, form).await
}

async fn handle_token_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    form: axum::extract::Form<auth::TokenForm>,
) -> impl IntoResponse {
    auth::token_handler(axum::extract::State(state.auth), headers, form).await
}

async fn handle_revoke_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
    form: Option<axum::extract::Form<std::collections::HashMap<String, String>>>,
) -> impl IntoResponse {
    auth::revoke_handler(axum::extract::State(state.auth), form).await
}

async fn handle_openid_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    auth::openid_config_handler(axum::extract::State(state.auth)).await
}

async fn handle_jwks_combined(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    auth::jwks_handler(axum::extract::State(state.auth)).await
}

async fn root_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl IntoResponse {
    let issuer = state.auth.read().await.issuer.clone();
    Json(json!({
        "name": "scalable-mock",
        "version": env!("CARGO_PKG_VERSION"),
        "issuer": issuer,
        "graphql_url": format!("{}/graphql", issuer.trim_end_matches('/')),
        "endpoints": [
            "POST /oauth/device/code",
            "POST /oauth/token",
            "GET /.well-known/openid-configuration",
            "GET /jwks",
            "POST /graphql",
            "POST /api/cli/graphql"
        ]
    }))
}

async fn fallback_handler(req: Request) -> impl IntoResponse {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();
    eprintln!("[mock] fallback {} {}", method, path);
    (StatusCode::NOT_FOUND, Json(json!({"error": "not_found", "path": path})))
}
