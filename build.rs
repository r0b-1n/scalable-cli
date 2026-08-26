use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=config/dev-channel.toml");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("config").join("dev-channel.toml");
    let raw = fs::read_to_string(&config_path).unwrap_or_else(|err| {
        panic!(
            "failed reading dev channel config {}: {err}",
            config_path.display()
        )
    });
    let parsed: toml::Value = toml::from_str(&raw).unwrap_or_else(|err| {
        panic!(
            "failed parsing dev channel config {}: {err}",
            config_path.display()
        )
    });

    let graphql_url = parsed
        .get("graphql_url")
        .and_then(toml::Value::as_str)
        .unwrap_or_else(|| panic!("missing graphql_url in {}", config_path.display()));
    let auth = parsed
        .get("auth")
        .and_then(toml::Value::as_table)
        .unwrap_or_else(|| panic!("missing [auth] table in {}", config_path.display()));
    let auth_value = |key: &str| {
        auth.get(key)
            .and_then(toml::Value::as_str)
            .unwrap_or_else(|| panic!("missing auth.{key} in {}", config_path.display()))
    };

    let generated = format!(
        "pub const GRAPHQL_URL: &str = {:?};\npub const AUTH_ISSUER: &str = {:?};\npub const AUTH_AUDIENCE: &str = {:?};\npub const AUTH_CLIENT_ID: &str = {:?};\n",
        graphql_url,
        auth_value("issuer"),
        auth_value("audience"),
        auth_value("client_id"),
    );

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("dev_channel_config.rs"), generated)
        .expect("failed writing generated dev channel config");
}
