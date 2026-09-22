//! Closed semantic reads over the same source-bound projection used by the library.
//! No model, blob reads, user SQL, or second mutable fact store.
use crate::StoreError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub fn catalog() -> Value {
    let mut catalog: Value = serde_json::from_str(include_str!(
        "../../../../../libs/aven-artifact-store/knowledge-catalog.json"
    ))
    .expect("source-controlled knowledge catalog");
    for collection in catalog["collections"]
        .as_object_mut()
        .expect("collections")
        .values_mut()
    {
        let measures = collection["measures"].as_array().expect("measures").clone();
        for measure in measures {
            collection["fields"][measure.as_str().expect("measure name")] = json!("integer-minor");
        }
    }
    catalog
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Predicate {
    field: String,
    op: String,
    #[serde(default)]
    values: Vec<String>,
}

pub fn predicates(collection: &str, raw: Option<&str>) -> Result<Value, StoreError> {
    let invalid = |message: &str| StoreError::InvalidLibraryQuery(message.into());
    let raw = raw.unwrap_or("[]");
    if raw.len() > 4096 {
        return Err(invalid("Knowledge filters exceed 4096 bytes."));
    }
    let filters: Vec<Predicate> = serde_json::from_str(raw)
        .map_err(|_| invalid("Use an array of {field, op, values} predicates."))?;
    if filters.len() > 8 {
        return Err(invalid("Use at most eight knowledge predicates."));
    }
    let schema = catalog();
    let fields = &schema["collections"][collection]["fields"];
    if !fields.is_object() {
        return Err(invalid("Unknown knowledge collection."));
    }
    for predicate in &filters {
        if fields.get(&predicate.field).is_none()
            && schema["commonFields"].get(&predicate.field).is_none()
        {
            return Err(invalid(
                "Unknown property for this collection; inspect the knowledge schema.",
            ));
        }
        if !matches!(
            (predicate.op.as_str(), predicate.values.len()),
            ("present", 0) | ("eq", 1) | ("not-in", 1..=16)
        ) {
            return Err(invalid(
                "present takes no values; eq takes one; not-in takes one to sixteen.",
            ));
        }
        if predicate
            .values
            .iter()
            .any(|v| v.is_empty() || v.chars().count() > 256 || v.contains('\0'))
        {
            return Err(invalid(
                "Predicate values must contain 1–256 characters, without NUL.",
            ));
        }
        if fields[&predicate.field] == "currency"
            && predicate
                .values
                .iter()
                .any(|v| v.len() != 3 || !v.bytes().all(|b| b.is_ascii_uppercase()))
        {
            return Err(invalid(
                "Use an uppercase three-letter reported currency code.",
            ));
        }
        if fields[&predicate.field] == "integer-minor"
            && predicate.values.iter().any(|value| {
                let digits = value.strip_prefix('-').unwrap_or(value);
                digits.is_empty()
                    || digits.len() > 128
                    || !digits.bytes().all(|b| b.is_ascii_digit())
                    || (digits.len() > 1 && digits.starts_with('0'))
                    || value == "-0"
            })
        {
            return Err(invalid(
                "Use canonical integer minor units, without decimal separators or leading zeros.",
            ));
        }
    }
    Ok(json!(filters))
}

pub fn validate_view(
    collection: &str,
    view: &str,
    measure: Option<&str>,
) -> Result<(), StoreError> {
    if !["schema", "rows", "summary"].contains(&view) || (view != "summary" && measure.is_some()) {
        return Err(StoreError::InvalidLibraryQuery(
            "Use rows or summary; a measure belongs only to summary.".into(),
        ));
    }
    if let Some(measure) = measure {
        if !catalog()["collections"][collection]["measures"]
            .as_array()
            .is_some_and(|values| values.contains(&json!(measure)))
        {
            return Err(StoreError::InvalidLibraryQuery(
                "Unknown measure; inspect the knowledge schema.".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_predicates_cannot_be_sql_or_cross_collection_properties() {
        assert!(predicates(
            "invoices",
            Some(r#"[{"field":"supplier","op":"not-in","values":["Berlin","Munich"]}]"#)
        )
        .is_ok());
        for raw in [
            r#"[{"field":"destination","op":"eq","values":["Berlin"]}]"#,
            r#"[{"field":"supplier","op":"eval","values":["1=1"]}]"#,
            r#"[{"field":"supplier","op":"present","values":["yes"]}]"#,
            r#"[{"field":"currency","op":"eq","values":["eur"]}]"#,
            r#"[{"field":"supplier","op":"eq","values":["A"],"sql":"x"}]"#,
        ] {
            assert!(predicates("invoices", Some(raw)).is_err());
        }
        assert!(validate_view("invoices", "summary", Some("grossMinor")).is_ok());
        assert!(validate_view("documents", "summary", Some("grossMinor")).is_err());
        assert!(validate_view("invoices", "rows", Some("grossMinor")).is_err());
    }
}
