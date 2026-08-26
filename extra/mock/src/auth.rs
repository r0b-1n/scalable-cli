use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use rand::{distributions::Alphanumeric, Rng};
use rsa::traits::PublicKeyParts;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct JwtKeys {
    pub encoding_key: EncodingKey,
    pub kid: String,
    pub n: String,
    pub e: String,
}

impl JwtKeys {
    pub fn new() -> Self {
        // Generate RSA key using rsa crate via jsonwebtoken's EncodingKey from secret is not RSA.
        // Instead we generate a static test key using rsa crate.
        use rsa::pkcs8::EncodePrivateKey;
        use rsa::RsaPrivateKey;

        let mut rng = rand::thread_rng();
        let private_key = RsaPrivateKey::new(&mut rng, 2048).expect("rsa gen");
        let pem = private_key
            .to_pkcs8_pem(rsa::pkcs8::LineEnding::LF)
            .expect("pem");
        let encoding_key = EncodingKey::from_rsa_pem(pem.as_bytes()).expect("encoding key");
        // Extract n,e for JWKS
        let n_bytes = private_key.n().to_bytes_be();
        let e_bytes = private_key.e().to_bytes_be();
        let n = URL_SAFE_NO_PAD.encode(n_bytes);
        let e = URL_SAFE_NO_PAD.encode(e_bytes);
        Self {
            encoding_key,
            kid: "mock-kid-1".to_string(),
            n,
            e,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DeviceCodeEntry {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: i64,
    pub interval: u64,
    pub polls: usize,
    pub authorized: bool,
}

pub struct AuthState {
    pub jwt_keys: JwtKeys,
    pub issuer: String,
    pub audience: String,
    pub client_id: String,
    pub device_codes: HashMap<String, DeviceCodeEntry>,
}

impl AuthState {
    pub fn new(issuer: String, audience: String, client_id: String) -> Self {
        Self {
            jwt_keys: JwtKeys::new(),
            issuer,
            audience,
            client_id,
            device_codes: HashMap::new(),
        }
    }

    pub fn generate_token(&self, person_id: &str, session_id: &str) -> String {
        let now = Utc::now();
        let exp = now + Duration::seconds(3600);
        let claims = json!({
            "iss": self.issuer,
            "aud": self.audience,
            "azp": self.client_id,
            "sub": person_id,
            "exp": exp.timestamp(),
            "iat": now.timestamp(),
            "nbf": now.timestamp(),
            "https://de.scalable.capital/person_id": person_id,
            "https://de.scalable.capital/session_id": session_id,
            "person_id": person_id,
            "session_id": session_id,
        });
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(self.jwt_keys.kid.clone());
        encode(&header, &claims, &self.jwt_keys.encoding_key).expect("jwt encode")
    }
}

pub type SharedAuth = Arc<RwLock<AuthState>>;

#[derive(Deserialize)]
pub struct DeviceCodeForm {
    pub client_id: Option<String>,
    pub audience: Option<String>,
    pub scope: Option<String>,
}

pub async fn device_code_handler(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
    form: axum::extract::Form<DeviceCodeForm>,
) -> impl IntoResponse {
    // Validate DPoP header exists (lenient)
    let _dpop = headers.get("dpop").or_else(|| headers.get("DPoP"));
    let issuer = {
        let a = auth.read().await;
        a.issuer.clone()
    };
    let _ = form;
    let device_code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let user_code: String = format!(
        "{}-{}",
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(4)
            .map(char::from)
            .collect::<String>()
            .to_uppercase(),
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(4)
            .map(char::from)
            .collect::<String>()
            .to_uppercase()
    );
    let verification_uri = format!("{}/device", issuer.trim_end_matches('/'));
    let verification_uri_complete = format!("{}/device?user_code={}", issuer.trim_end_matches('/'), user_code);
    let entry = DeviceCodeEntry {
        device_code: device_code.clone(),
        user_code: user_code.clone(),
        verification_uri: verification_uri.clone(),
        verification_uri_complete: verification_uri_complete.clone(),
        expires_in: 300,
        interval: 5,
        polls: 0,
        authorized: false,
    };
    {
        let mut a = auth.write().await;
        a.device_codes.insert(device_code.clone(), entry);
    }
    let body = json!({
        "device_code": device_code,
        "user_code": user_code,
        "verification_uri": verification_uri,
        "verification_uri_complete": verification_uri_complete,
        "expires_in": 300,
        "interval": 5
    });
    (StatusCode::OK, Json(body))
}

#[derive(Deserialize)]
pub struct TokenForm {
    pub grant_type: Option<String>,
    pub device_code: Option<String>,
    pub client_id: Option<String>,
    pub refresh_token: Option<String>,
    pub session_id: Option<String>,
}

pub async fn token_handler(
    State(auth): State<SharedAuth>,
    headers: HeaderMap,
    form: axum::extract::Form<TokenForm>,
) -> impl IntoResponse {
    let dpop_header = headers.get("dpop").or_else(|| headers.get("DPoP"));
    // Handle DPoP nonce challenge if needed - we just check for existence, mock will not require nonce unless we simulate
    // For first request without nonce, we could return use_dpop_nonce once, but to keep simple we accept any.
    let _ = dpop_header;

    let grant_type = form.grant_type.clone().unwrap_or_default();
    if grant_type.contains("device_code") {
        let device_code = form.device_code.clone().unwrap_or_default();
        let mut auth_guard = auth.write().await;
        if let Some(entry) = auth_guard.device_codes.get_mut(&device_code) {
            entry.polls += 1;
            if entry.polls < 2 {
                let body = json!({
                    "error": "authorization_pending",
                    "error_description": "User has not yet completed authorization"
                });
                return (StatusCode::BAD_REQUEST, Json(body)).into_response();
            }
            // authorized
            let person_id = "person-1";
            let session_id = format!("sess-{}", rand::thread_rng().gen::<u32>());
            let issuer_clone = auth_guard.issuer.clone();
            let jwt_keys_clone = auth_guard.jwt_keys.clone();
            // need to generate token without holding lock? clone and drop guard first
            drop(auth_guard);
            let auth_read = auth.read().await;
            let token = auth_read.generate_token(person_id, &session_id);
            let refresh_token = format!("mock-refresh-{}", rand::thread_rng().gen::<u32>());
            let id_token = token.clone(); // same for mock
            let body = json!({
                "access_token": token,
                "refresh_token": refresh_token,
                "id_token": id_token,
                "expires_in": 3600,
                "token_type": "Bearer"
            });
            return (StatusCode::OK, Json(body)).into_response();
        } else {
            let body = json!({
                "error": "expired_token",
                "error_description": "Device code expired"
            });
            return (StatusCode::BAD_REQUEST, Json(body)).into_response();
        }
    } else if grant_type == "refresh_token" {
        let auth_read = auth.read().await;
        // Validate refresh_token present
        if form.refresh_token.is_none() || form.refresh_token.as_ref().unwrap().is_empty() {
            let body = json!({
                "error": "invalid_grant",
                "error_description": "Missing refresh_token"
            });
            return (StatusCode::BAD_REQUEST, Json(body)).into_response();
        }
        let person_id = "person-1";
        let session_id = form.session_id.clone().unwrap_or_else(|| format!("sess-{}", rand::thread_rng().gen::<u32>()));
        let token = auth_read.generate_token(person_id, &session_id);
        let new_refresh = format!("mock-refresh-{}", rand::thread_rng().gen::<u32>());
        let body = json!({
            "access_token": token,
            "refresh_token": new_refresh,
            "id_token": token,
            "expires_in": 3600,
            "token_type": "Bearer"
        });
        return (StatusCode::OK, Json(body)).into_response();
    } else {
        let body = json!({
            "error": "unsupported_grant_type",
            "error_description": format!("Grant type {} not supported", grant_type)
        });
        return (StatusCode::BAD_REQUEST, Json(body)).into_response();
    }
}

pub async fn revoke_handler(
    State(_auth): State<SharedAuth>,
    _form: Option<axum::extract::Form<HashMap<String, String>>>,
) -> impl IntoResponse {
    (StatusCode::OK, Json(json!({})))
}

pub async fn openid_config_handler(State(auth): State<SharedAuth>) -> impl IntoResponse {
    let auth_read = auth.read().await;
    let body = json!({
        "issuer": auth_read.issuer,
        "jwks_uri": format!("{}/jwks", auth_read.issuer.trim_end_matches('/')),
        "authorization_endpoint": format!("{}/authorize", auth_read.issuer.trim_end_matches('/')),
        "token_endpoint": format!("{}/oauth/token", auth_read.issuer.trim_end_matches('/')),
        "revocation_endpoint": format!("{}/oauth/revoke", auth_read.issuer.trim_end_matches('/')),
    });
    (StatusCode::OK, Json(body))
}

pub async fn jwks_handler(State(auth): State<SharedAuth>) -> impl IntoResponse {
    let auth_read = auth.read().await;
    let body = json!({
        "keys": [{
            "kid": auth_read.jwt_keys.kid,
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "n": auth_read.jwt_keys.n,
            "e": auth_read.jwt_keys.e,
        }]
    });
    (StatusCode::OK, Json(body))
}

pub async fn authorize_handler() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({"message": "Mock authorize endpoint - auto approved"})))
}

pub async fn device_page_handler() -> impl IntoResponse {
    let html = r#"<!doctype html><html><body><h1>Mock Device Verification</h1><p>Auto-approved for testing. No user action needed.</p></body></html>"#;
    ([("content-type", "text/html")], html)
}
