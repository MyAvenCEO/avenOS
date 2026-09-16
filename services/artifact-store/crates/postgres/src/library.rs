//! Read-only, source-bound projections for the workspace library.
use crate::{PostgresStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryQuery {
    pub collection: String,
    pub category: Option<String>,
    pub search: Option<String>,
    pub source_id: Option<Uuid>,
    pub sort: Option<String>,
    pub direction: Option<String>,
    pub after: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cursor {
    epoch: Uuid,
    scope: Uuid,
    snapshot: i64,
    query: Value,
    value: Value,
    key: String,
}

impl PostgresStore {
    /// Page through extracted observations without scanning publication envelopes or blobs.
    /// # Errors
    /// Rejects invalid or stale cursors and propagates scoped database failures.
    pub async fn library(&self, scope: Uuid, query: LibraryQuery) -> Result<Value, StoreError> {
        let invalid = || {
            StoreError::InvalidLibraryQuery(
                "invalid or stale library query; refresh the collection".into(),
            )
        };
        if ![
            "documents",
            "invoices",
            "statements",
            "transactions",
            "line-items",
        ]
        .contains(&query.collection.as_str())
            || query.search.as_ref().is_some_and(|s| s.len() > 512)
            || query.after.as_ref().is_some_and(|s| s.len() > 4096)
            || query.sort.as_ref().is_some_and(|s| s.len() > 64)
        {
            return Err(invalid());
        }
        let category = query.category.as_deref().unwrap_or("all");
        if ![
            "all", "email", "invoice", "credit-note", "receipt", "statement", "voucher",
            "contract", "contract-summary", "transport-ticket", "booking-confirmation",
            "delivery-notification", "other", "unknown",
        ]
        .contains(&category)
        {
            return Err(invalid());
        }
        let direction = query.direction.as_deref().unwrap_or("desc");
        if direction != "asc" && direction != "desc" {
            return Err(invalid());
        }
        let search = query.search.as_deref().unwrap_or("").trim();
        let sort = query.sort.as_deref().unwrap_or("date");
        let sortable: &[&str] = match query.collection.as_str() {
            "documents" => &["date", "name", "category", "mediaType", "size"],
            "invoices" => &["date", "supplier", "invoiceNumber", "issueDate", "grossMinor", "dueDate", "netMinor", "taxMinor", "currency"],
            "statements" => &["date", "accountHolder", "accountIban", "periodStart", "periodEnd", "openingBalanceMinor", "closingBalanceMinor", "currency"],
            "transactions" => &["date", "bookingDate", "counterpartyName", "description", "amountMinor", "accountIban", "valueDate"],
            "line-items" => &["date", "invoiceNumber", "description", "quantity", "unitPriceMinor", "netMinor", "grossMinor"],
            _ => return Err(invalid()),
        };
        if !sortable.contains(&sort) {
            return Err(invalid());
        }
        let limit = query.limit.unwrap_or(50).clamp(1, 100);
        let identity = json!([
            query.collection,
            category,
            search,
            query.source_id,
            sort,
            direction
        ]);
        let epoch: Uuid = sqlx::query_scalar(
            "SELECT store_epoch FROM artifact_store.store_state WHERE singleton=true",
        )
        .fetch_one(&self.pool)
        .await?;
        let latest: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(scope_sequence),0) FROM artifact_store.publications WHERE scope_id=$1")
            .bind(scope).fetch_one(&self.pool).await?;
        let cursor: Option<Cursor> = query
            .after
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| invalid())?;
        if cursor.as_ref().is_some_and(|c| {
            c.epoch != epoch
                || c.scope != scope
                || c.query != identity
                || c.snapshot > latest
                || c.snapshot < 0
                || c.key.len() > 256
        }) {
            return Err(invalid());
        }
        let snapshot = cursor.as_ref().map_or(latest, |c| c.snapshot);
        let rows = sqlx::query(include_str!("library.sql"))
            .bind(scope)
            .bind(snapshot)
            .bind(&query.collection)
            .bind(category)
            .bind(search)
            .bind(query.source_id)
            .bind(sort)
            .bind(direction)
            .bind(cursor.as_ref().map(|c| &c.value))
            .bind(cursor.as_ref().map(|c| &c.key))
            .bind(i64::from(limit) + 1)
            .fetch_all(&self.pool)
            .await?;
        let next = if rows.len() > limit as usize {
            let row = &rows[limit as usize - 1];
            Some(serde_json::to_string(&Cursor {
                epoch,
                scope,
                snapshot,
                query: identity,
                value: row.try_get("sort_value")?,
                key: row.try_get("key")?,
            })?)
        } else {
            None
        };
        let items: Vec<Value> = rows
            .iter()
            .take(limit as usize)
            .map(|r| r.try_get("item"))
            .collect::<Result<_, _>>()?;
        Ok(
            json!({ "storeEpoch": epoch, "snapshotSequence": snapshot, "items": items, "nextAfter": next }),
        )
    }
}
