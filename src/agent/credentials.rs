//! Provider API-key storage, reusing `crate::session::StorageBackend`
//! rather than a second keyring/file implementation (fix F21).

use anyhow::{Result, bail};

use crate::config::{AppConfig, SessionBackendPreference};
use crate::session::{SecretStore, StorageBackend};

/// Provider ids are validated at config-write time (`config::validate_id`)
/// to match `^[a-z0-9][a-z0-9_-]{0,63}$` — this guarantees the derived
/// credential key below is a legal path component on every OS (no colon, no
/// path separator, no reserved Windows character), closing fix F4.
fn credential_key(provider_id: &str) -> String {
    format!("agent-provider-{provider_id}")
}

pub(crate) struct ProviderSecret {
    pub api_key: Option<String>,
}

pub(crate) fn store_for(
    config: &AppConfig,
    backend_override: Option<SessionBackendPreference>,
) -> Result<StorageBackend> {
    match backend_override {
        Some(pref) => StorageBackend::from_preference(pref),
        None => StorageBackend::from_config(config),
    }
}

pub(crate) fn set_provider_credential(
    store: &StorageBackend,
    provider_id: &str,
    api_key: &str,
) -> Result<()> {
    if api_key.trim().is_empty() {
        bail!("Agent input invalid: api key must not be empty");
    }
    store.set(&credential_key(provider_id), api_key.trim())
}

pub(crate) fn get_provider_credential(
    store: &StorageBackend,
    provider_id: &str,
) -> Result<Option<String>> {
    store.get(&credential_key(provider_id))
}

/// Reports whether a credential is stored for `provider_id`, for callers such
/// as `sc agent provider show` that must never have the key value pass
/// through them. The key is read from the backend to answer the question but
/// is dropped immediately; only presence escapes this function.
pub(crate) fn has_credential(store: &StorageBackend, provider_id: &str) -> Result<bool> {
    Ok(get_provider_credential(store, provider_id)?.is_some())
}

pub(crate) fn delete_provider_credential(store: &StorageBackend, provider_id: &str) -> Result<()> {
    store.delete(&credential_key(provider_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::FileStore;

    #[test]
    fn credential_key_never_contains_a_colon() {
        assert_eq!(credential_key("anthropic-main"), "agent-provider-anthropic-main");
        assert!(!credential_key("anthropic-main").contains(':'));
    }

    fn file_backed_store() -> (tempfile::TempDir, StorageBackend) {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = StorageBackend::File(
            FileStore::new(tmp.path().to_path_buf()).expect("file store"),
        );
        (tmp, store)
    }

    #[test]
    fn set_then_get_round_trips_the_key() {
        let (_tmp, store) = file_backed_store();
        set_provider_credential(&store, "anthropic-main", "sk-abc123").expect("set");
        assert_eq!(
            get_provider_credential(&store, "anthropic-main").expect("get"),
            Some("sk-abc123".to_string())
        );
    }

    #[test]
    fn set_trims_surrounding_whitespace() {
        let (_tmp, store) = file_backed_store();
        set_provider_credential(&store, "anthropic-main", "  sk-abc123  \n").expect("set");
        assert_eq!(
            get_provider_credential(&store, "anthropic-main").expect("get"),
            Some("sk-abc123".to_string())
        );
    }

    #[test]
    fn set_rejects_empty_or_blank_key() {
        let (_tmp, store) = file_backed_store();
        assert!(set_provider_credential(&store, "anthropic-main", "").is_err());
        assert!(set_provider_credential(&store, "anthropic-main", "   ").is_err());
    }

    #[test]
    fn get_returns_none_when_nothing_stored() {
        let (_tmp, store) = file_backed_store();
        assert_eq!(
            get_provider_credential(&store, "anthropic-main").expect("get"),
            None
        );
    }

    #[test]
    fn has_credential_reflects_presence_without_exposing_the_key() {
        let (_tmp, store) = file_backed_store();
        assert!(!has_credential(&store, "anthropic-main").expect("has_credential"));

        set_provider_credential(&store, "anthropic-main", "sk-abc123").expect("set");
        assert!(has_credential(&store, "anthropic-main").expect("has_credential"));
    }

    #[test]
    fn delete_removes_the_credential() {
        let (_tmp, store) = file_backed_store();
        set_provider_credential(&store, "anthropic-main", "sk-abc123").expect("set");

        delete_provider_credential(&store, "anthropic-main").expect("delete");

        assert_eq!(
            get_provider_credential(&store, "anthropic-main").expect("get"),
            None
        );
        assert!(!has_credential(&store, "anthropic-main").expect("has_credential"));
    }

    #[test]
    fn delete_of_missing_credential_is_not_an_error() {
        let (_tmp, store) = file_backed_store();
        assert!(delete_provider_credential(&store, "anthropic-main").is_ok());
    }

    #[test]
    fn distinct_provider_ids_do_not_collide() {
        let (_tmp, store) = file_backed_store();
        set_provider_credential(&store, "anthropic-main", "sk-anthropic").expect("set");
        set_provider_credential(&store, "openai-main", "sk-openai").expect("set");

        assert_eq!(
            get_provider_credential(&store, "anthropic-main").expect("get"),
            Some("sk-anthropic".to_string())
        );
        assert_eq!(
            get_provider_credential(&store, "openai-main").expect("get"),
            Some("sk-openai".to_string())
        );
    }
}
