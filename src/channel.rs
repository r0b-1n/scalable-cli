use anyhow::{Result, bail};

use crate::config::{AppConfig, AuthConfig, EnvConfig, TargetEnv};
use crate::dpop::DpopRuntimeOptions;

#[cfg(not(feature = "channel-prod"))]
mod generated_dev_channel {
    include!(concat!(env!("OUT_DIR"), "/dev_channel_config.rs"));
}

pub const fn current_env() -> TargetEnv {
    #[cfg(feature = "channel-prod")]
    {
        TargetEnv::Prod
    }
    #[cfg(not(feature = "channel-prod"))]
    {
        TargetEnv::Dev
    }
}

pub fn current_env_config() -> EnvConfig {
    #[cfg(test)]
    if let Some(config) = current_env_config_override() {
        return config;
    }

    if let Some(mock) = mock_env_config_from_env() {
        warn_mock_override_once(&mock);
        return mock;
    }

    #[cfg(feature = "channel-prod")]
    {
        EnvConfig {
            graphql_url: "https://de.scalable.capital/api/cli/graphql".to_string(),
            auth: AuthConfig {
                issuer: "https://secure.scalable.capital".to_string(),
                audience: "https://de.scalable.capital/api-gateway".to_string(),
                client_id: "yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE".to_string(),
            },
        }
    }
    #[cfg(not(feature = "channel-prod"))]
    {
        compiled_dev_env_config()
    }
}

/// One-time stderr banner so a shell with a leftover SC_MOCK/SC_GRAPHQL_URL can never
/// silently talk to something other than the built-in environment.
fn warn_mock_override_once(config: &EnvConfig) {
    static WARN_ONCE: std::sync::Once = std::sync::Once::new();
    WARN_ONCE.call_once(|| {
        eprintln!(
            "warning: SC_MOCK/SC_GRAPHQL_URL override active — using GraphQL endpoint '{}' and issuer '{}' instead of the built-in environment",
            config.graphql_url, config.auth.issuer
        );
    });
}

/// Environment override used for local mock/offline testing. Endpoint URLs returned
/// here are still subject to `validate_https_url` at every call site (https, or http
/// to a loopback host only), and the HTTP client stays HTTPS-only unless
/// `transport_security::mock_loopback_override_active` confirms a loopback-only setup.
pub(crate) fn mock_env_config_from_env() -> Option<EnvConfig> {
    // Priority: explicit SC_GRAPHQL_URL, then SC_MOCK flag
    if let Ok(url) = std::env::var("SC_GRAPHQL_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            let issuer = std::env::var("SC_OAUTH_ISSUER")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "http://127.0.0.1:4010".to_string());
            let audience = std::env::var("SC_OAUTH_AUDIENCE")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "https://de.scalable.capital/api-gateway".to_string());
            let client_id = std::env::var("SC_OAUTH_CLIENT_ID")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE".to_string());
            return Some(EnvConfig {
                graphql_url: trimmed.to_string(),
                auth: AuthConfig {
                    issuer: issuer.trim().to_string(),
                    audience: audience.trim().to_string(),
                    client_id: client_id.trim().to_string(),
                },
            });
        }
    }
    if let Ok(mock_flag) = std::env::var("SC_MOCK") {
        let flag = mock_flag.trim().to_lowercase();
        if flag == "1" || flag == "true" || flag == "yes" || flag == "on" {
            let port = std::env::var("SC_MOCK_PORT")
                .ok()
                .and_then(|v| v.trim().parse::<u16>().ok())
                .unwrap_or(4010);
            let issuer = format!("http://127.0.0.1:{}", port);
            let graphql_url = format!("http://127.0.0.1:{}/graphql", port);
            return Some(EnvConfig {
                graphql_url,
                auth: AuthConfig {
                    issuer,
                    audience: "https://de.scalable.capital/api-gateway".to_string(),
                    client_id: "yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE".to_string(),
                },
            });
        }
    }
    None
}

#[cfg(not(feature = "channel-prod"))]
fn compiled_dev_env_config() -> EnvConfig {
    EnvConfig {
        graphql_url: generated_dev_channel::GRAPHQL_URL.to_string(),
        auth: AuthConfig {
            issuer: generated_dev_channel::AUTH_ISSUER.to_string(),
            audience: generated_dev_channel::AUTH_AUDIENCE.to_string(),
            client_id: generated_dev_channel::AUTH_CLIENT_ID.to_string(),
        },
    }
}

#[cfg(test)]
fn current_env_config_override() -> Option<EnvConfig> {
    let guard = match test_env_config_override_store().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.clone()
}

#[cfg(test)]
fn test_env_config_override_store() -> &'static std::sync::Mutex<Option<EnvConfig>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<Option<EnvConfig>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(test)]
pub(crate) struct TestEnvConfigOverrideGuard {}

#[cfg(test)]
impl TestEnvConfigOverrideGuard {
    pub(crate) fn set(config: EnvConfig) -> Self {
        let mut override_guard = match test_env_config_override_store().lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        debug_assert!(
            override_guard.is_none(),
            "test env config override should not be nested"
        );
        *override_guard = Some(config);
        Self {}
    }
}

#[cfg(test)]
impl Drop for TestEnvConfigOverrideGuard {
    fn drop(&mut self) {
        let mut override_guard = match test_env_config_override_store().lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *override_guard = None;
    }
}

pub fn current_dpop_runtime_options(config: &AppConfig) -> DpopRuntimeOptions {
    DpopRuntimeOptions {
        key_backend: config.auth.signing_key_backend,
        pkcs11: config.auth.pkcs11.clone(),
    }
}

pub fn require_current_channel(env: TargetEnv) -> Result<()> {
    let current = current_env();
    if env != current {
        bail!(
            "Stored session belongs to {env}, but this binary is locked to {current}. Run 'sc login' to replace it."
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_channel_has_https_endpoints() {
        let _lock = crate::lock_test_env();
        let cfg = current_env_config();
        assert!(cfg.graphql_url.starts_with("https://"));
        assert!(cfg.auth.issuer.starts_with("https://"));
    }

    struct EnvGuard {
        key: &'static str,
        original: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let original = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key, original }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(value) => unsafe {
                    std::env::set_var(self.key, value);
                },
                None => unsafe {
                    std::env::remove_var(self.key);
                },
            }
        }
    }

    #[test]
    fn mock_env_config_absent_without_override_vars() {
        let _lock = crate::lock_test_env();
        assert!(mock_env_config_from_env().is_none());
    }

    #[test]
    fn mock_env_config_via_sc_mock_targets_loopback() {
        let _lock = crate::lock_test_env();
        let _mock = EnvGuard::set("SC_MOCK", "1");
        let cfg = mock_env_config_from_env().expect("override active");
        assert_eq!(cfg.graphql_url, "http://127.0.0.1:4010/graphql");
        assert_eq!(cfg.auth.issuer, "http://127.0.0.1:4010");
    }

    #[test]
    fn mock_env_config_ignores_falsy_sc_mock() {
        let _lock = crate::lock_test_env();
        let _mock = EnvGuard::set("SC_MOCK", "0");
        assert!(mock_env_config_from_env().is_none());
    }

    #[test]
    fn mock_env_config_prefers_explicit_graphql_url() {
        let _lock = crate::lock_test_env();
        let _mock = EnvGuard::set("SC_MOCK", "1");
        let _url = EnvGuard::set("SC_GRAPHQL_URL", " http://localhost:9999/graphql ");
        let cfg = mock_env_config_from_env().expect("override active");
        assert_eq!(cfg.graphql_url, "http://localhost:9999/graphql");
    }

    #[test]
    #[cfg(not(feature = "channel-prod"))]
    fn current_dev_channel_policy_matches_generated_dev_config() {
        let _lock = crate::lock_test_env();
        let env = current_env();
        let cfg = current_env_config();
        let expected = expected_dev_env_config_from_toml();

        assert_eq!(env, TargetEnv::Dev);
        assert_eq!(cfg.graphql_url, expected.graphql_url);
        assert_eq!(cfg.auth.issuer, expected.auth.issuer);
        assert_eq!(cfg.auth.audience, expected.auth.audience);
        assert_eq!(cfg.auth.client_id, expected.auth.client_id);
    }

    #[test]
    #[cfg(feature = "channel-prod")]
    fn current_prod_channel_policy_matches_expected_env() {
        let _lock = crate::lock_test_env();
        let env = current_env();
        let cfg = current_env_config();

        assert_eq!(env, TargetEnv::Prod);
        assert_eq!(
            cfg.graphql_url,
            "https://de.scalable.capital/api/cli/graphql"
        );
        assert_eq!(cfg.auth.issuer, "https://secure.scalable.capital");
        assert_eq!(cfg.auth.audience, "https://de.scalable.capital/api-gateway");
        assert_eq!(cfg.auth.client_id, "yBM3BrpRgwSTJZRdJllvtD6jJEmyxWfE");
    }

    #[cfg(not(feature = "channel-prod"))]
    fn expected_dev_env_config_from_toml() -> EnvConfig {
        use std::fs;
        use std::path::PathBuf;

        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config/dev-channel.toml");
        let raw = fs::read_to_string(&path).unwrap_or_else(|err| {
            panic!(
                "failed reading dev channel config {}: {err}",
                path.display()
            )
        });
        let parsed = toml::from_str::<toml::Value>(&raw).unwrap_or_else(|err| {
            panic!(
                "failed parsing dev channel config {}: {err}",
                path.display()
            )
        });
        let auth = parsed
            .get("auth")
            .and_then(toml::Value::as_table)
            .unwrap_or_else(|| panic!("missing [auth] table in {}", path.display()));

        EnvConfig {
            graphql_url: parsed
                .get("graphql_url")
                .and_then(toml::Value::as_str)
                .unwrap_or_else(|| panic!("missing graphql_url in {}", path.display()))
                .to_string(),
            auth: AuthConfig {
                issuer: auth
                    .get("issuer")
                    .and_then(toml::Value::as_str)
                    .unwrap_or_else(|| panic!("missing auth.issuer in {}", path.display()))
                    .to_string(),
                audience: auth
                    .get("audience")
                    .and_then(toml::Value::as_str)
                    .unwrap_or_else(|| panic!("missing auth.audience in {}", path.display()))
                    .to_string(),
                client_id: auth
                    .get("client_id")
                    .and_then(toml::Value::as_str)
                    .unwrap_or_else(|| panic!("missing auth.client_id in {}", path.display()))
                    .to_string(),
            },
        }
    }

    #[test]
    fn current_dpop_runtime_options_use_runtime_key_backend() {
        let options = current_dpop_runtime_options(&AppConfig::default());
        assert_eq!(
            options.key_backend,
            AppConfig::default().auth.signing_key_backend
        );
        assert_eq!(options.pkcs11, AppConfig::default().auth.pkcs11);
    }

    #[test]
    fn current_dpop_runtime_options_include_pkcs11_config() {
        let config = AppConfig {
            auth: crate::config::RuntimeAuthConfig {
                session_backend: crate::config::SessionBackendPreference::File,
                signing_key_backend: crate::config::DpopKeyBackend::Pkcs11,
                pkcs11: Some(crate::config::Pkcs11Config {
                    module_path: "/usr/lib/opensc-pkcs11.so".to_string(),
                    key_uri: "pkcs11:token=YubiKey%20PIV;id=%01".to_string(),
                }),
            },
            trade_controls: None,
        };

        let options = current_dpop_runtime_options(&config);
        assert_eq!(options.key_backend, crate::config::DpopKeyBackend::Pkcs11);
        assert_eq!(options.pkcs11, config.auth.pkcs11);
    }

    #[test]
    fn test_env_config_override_guard_is_scoped() {
        let _lock = crate::lock_test_env();
        let compiled = current_env_config();
        let override_cfg = EnvConfig {
            graphql_url: "https://override.invalid/graphql".to_string(),
            auth: AuthConfig {
                issuer: "https://override.invalid".to_string(),
                audience: "override-audience".to_string(),
                client_id: "override-client".to_string(),
            },
        };

        {
            let _guard = TestEnvConfigOverrideGuard::set(override_cfg.clone());
            let current = current_env_config();
            assert_eq!(current.graphql_url, override_cfg.graphql_url);
            assert_eq!(current.auth.issuer, override_cfg.auth.issuer);
            assert_eq!(current.auth.audience, override_cfg.auth.audience);
            assert_eq!(current.auth.client_id, override_cfg.auth.client_id);
        }

        let restored = current_env_config();
        assert_eq!(restored.graphql_url, compiled.graphql_url);
        assert_eq!(restored.auth.issuer, compiled.auth.issuer);
        assert_eq!(restored.auth.audience, compiled.auth.audience);
        assert_eq!(restored.auth.client_id, compiled.auth.client_id);
    }
}
