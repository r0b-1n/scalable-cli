//! Pure `[trade_controls]` editing for config.toml, kept free of Tauri so it
//! can be unit-tested on its own.
use toml_edit::{value, Array, DocumentMut, Item, Table};

fn isin_array(isins: &[String]) -> Item {
    value(isins.iter().map(|s| s.trim().to_uppercase()).collect::<Array>())
}

/// Replaces `[trade_controls]` and leaves the rest of the file — other
/// sections, comments, formatting — untouched. `None` removes a control;
/// `Some(vec![])` for `allowed_isins` is kept, because the CLI reads an empty
/// allow-list as "nothing is tradable".
pub fn apply_trade_controls(
    current: &str,
    allowed_isins: &Option<Vec<String>>,
    denied_isins: &Option<Vec<String>>,
    max_order_notional: &Option<String>,
) -> Result<String, String> {
    let mut doc: DocumentMut = current
        .parse()
        .map_err(|e| format!("Existing config.toml is not valid TOML: {e}"))?;
    let mut table = Table::new();
    if let Some(list) = allowed_isins {
        table["allowed_isins"] = isin_array(list);
    }
    if let Some(list) = denied_isins {
        table["denied_isins"] = isin_array(list);
    }
    if let Some(max) = max_order_notional {
        table["max_order_notional"] = value(max.trim());
    }
    if table.is_empty() {
        doc.remove("trade_controls");
    } else {
        doc["trade_controls"] = Item::Table(table);
    }
    Ok(doc.to_string())
}

#[cfg(test)]
mod tests {
    use super::apply_trade_controls;

    #[test]
    fn replaces_only_the_trade_controls_section() {
        let current = "# keep me\n[auth]\nsession_backend = \"file\"\n\n[trade_controls]\nmax_order_notional = \"5\"\n";
        let out = apply_trade_controls(
            current,
            &Some(vec![" us0378331005 ".into()]),
            &None,
            &Some("1000".into()),
        )
        .unwrap();
        assert!(out.contains("# keep me"));
        assert!(out.contains("session_backend = \"file\""));
        assert!(out.contains("allowed_isins = [\"US0378331005\"]"));
        assert!(out.contains("max_order_notional = \"1000\""));
        assert!(!out.contains("\"5\""));
        assert!(!out.contains("denied_isins"));
    }

    #[test]
    fn keeps_an_empty_allow_list_and_drops_an_empty_section() {
        let out = apply_trade_controls("", &Some(vec![]), &None, &None).unwrap();
        assert!(out.contains("allowed_isins = []"));
        let out = apply_trade_controls("[trade_controls]\nmax_order_notional = \"5\"\n", &None, &None, &None).unwrap();
        assert!(!out.contains("trade_controls"));
    }
}
