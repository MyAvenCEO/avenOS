//! The aven-brain data model as an aven-db [`Schema`] — **three tables**:
//! `memories` · `entities` · `links` (see the v5 plan, board `plan/0018`).
//!
//! Mirrors `libs/aven-schema/schema.manifest.json` exactly (groove storage types), so the
//! same brain code runs over the lib's own store (tests) and the app's manifest-built
//! store. Sealed-at-rest columns are declared `Text`/`Bytea` per the app convention;
//! sealing itself is an app-layer concern.
//!
//! No `created_at`/`updated_at` columns anywhere: row [`groove::ObjectId`]s are UUIDv7
//! (time-ordered) and the engine's `RowProvenance` carries authorship — engine built-ins
//! are never duplicated (plan §2.1).

use groove::{ColumnType, Schema, SchemaBuilder, TableSchema, Value};

/// Default embedding dimensionality. EmbeddingGemma-300m's native size; Matryoshka-
/// truncatable to 128/256 for storage savings (the brain picks the dim at build time).
pub const EMBED_DIM: usize = 768;

/// Table names (single source of truth, shared by the schema and the pipeline).
pub const MEMORIES: &str = "memories";
pub const ENTITIES: &str = "entities";
pub const LINKS: &str = "links";

/// Build the aven-brain schema for a given embedding dimensionality.
///
/// `embed_dim` must match the embedding model the brain uses; changing it later requires
/// a re-embed + reindex (lens-driven; a future maintenance pass).
pub fn brain_schema(embed_dim: usize) -> Schema {
    SchemaBuilder::new()
        // ── memories: evidence — verbatim content + embedding + artifact columns ──
        .table(
            TableSchema::builder(MEMORIES)
                // routing — one brain per SAFE; every query is owner-scoped.
                .column("owner", ColumnType::Uuid)
                .column("content", ColumnType::Text)
                .nullable_column("embedding", ColumnType::Vector { dim: embed_dim })
                // Artifact columns (the memory's origin, denormalized for join-free
                // filtering): surface, author kind, origin row + position within it.
                .column("stream", ColumnType::Text)
                .column("author_role", ColumnType::Text)
                .nullable_column("source", ColumnType::Text)
                .nullable_column("seq", ColumnType::Integer)
                .nullable_column("line_start", ColumnType::Integer)
                .nullable_column("line_end", ColumnType::Integer)
                // Domain time (when the content happened) — ms-since-epoch as Text
                // (sealed `exposeTs: bigint` app convention). Write time = UUIDv7 row id.
                .nullable_column("content_date", ColumnType::Text)
                // Plaintext-content dedup key (the engine row digest covers the whole
                // sealed row and changes on any update — it can't serve content dedup).
                .nullable_column("content_hash", ColumnType::Bytea)
                .nullable_column("source_version", ColumnType::BigInt)
                .column_with_default("normalize_version", ColumnType::Integer, Value::Integer(1))
                // Trust class: stated | inferred | imported | tool | unknown.
                .nullable_column("veracity", ColumnType::Text)
                // Re-weighting, never deletion: replacement memory row id; the hot path
                // filters `IS NULL`.
                .nullable_column("superseded_by", ColumnType::Text)
                .index_only(["owner", "stream", "author_role", "source", "content_hash"]),
        )
        // ── entities: pure interpretation — names with NO backing artifact row ───
        .table(
            TableSchema::builder(ENTITIES)
                .column("owner", ColumnType::Uuid)
                .column("name", ColumnType::Text)
                .column("kind", ColumnType::Text)
                .nullable_column("properties", ColumnType::Json { schema: None })
                .index_only(["owner", "name", "kind"]),
        )
        // ── links: the one edge primitive — endpoints are ANY row ids ────────────
        // NOTE: `access_count` should use a Counter merge strategy so co-access sums
        // across devices; the TableSchemaBuilder doesn't expose merge strategies yet,
        // so it is plain LWW for now.
        .table(
            TableSchema::builder(LINKS)
                .column("owner", ColumnType::Uuid)
                // Row id strings (memory / entity / artifact row); the owning table
                // resolves via object metadata, no discriminator columns.
                .column("from", ColumnType::Text)
                .column("to", ColumnType::Text)
                // Registered kind; its class decides merge semantics (law 6).
                .column("kind", ColumnType::Text)
                .column("class", ColumnType::Text)
                // claim: validity window (ms-since-epoch as Text) + Bayesian confidence.
                .nullable_column("valid_from", ColumnType::Text)
                .nullable_column("valid_to", ColumnType::Text)
                .nullable_column("confidence", ColumnType::Double)
                // bond: dynamics (Hebbian potentiation + Ebbinghaus decay).
                .nullable_column("strength", ColumnType::Double)
                .nullable_column("stability", ColumnType::Double)
                .nullable_column("access_count", ColumnType::BigInt)
                .nullable_column("last_access", ColumnType::BigInt)
                // evidence: the memory row a claim was extracted from.
                .nullable_column("source_memory", ColumnType::Text)
                .index_only(["owner", "from", "to", "kind"]),
        )
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use groove::TableName;

    #[test]
    fn brain_schema_has_exactly_three_tables() {
        let schema = brain_schema(EMBED_DIM);
        for table in [MEMORIES, ENTITIES, LINKS] {
            assert!(
                schema.contains_key(&TableName::new(table)),
                "schema must contain table `{table}`"
            );
        }
        assert_eq!(schema.len(), 3, "three tables, forever (law 2)");
    }

    #[test]
    fn memory_embedding_is_a_native_vector_of_the_requested_dim() {
        let schema = brain_schema(256);
        let memories = schema
            .get(&TableName::new(MEMORIES))
            .expect("memories table exists");
        let embedding = memories
            .columns
            .column("embedding")
            .expect("memories has an embedding column");
        assert!(
            matches!(embedding.column_type, ColumnType::Vector { dim } if dim == 256),
            "embedding must be native Vector {{ dim: 256 }}, got {:?}",
            embedding.column_type
        );
    }

    #[test]
    fn memory_body_is_text_for_bm25() {
        let schema = brain_schema(EMBED_DIM);
        let memories = schema.get(&TableName::new(MEMORIES)).unwrap();
        let content = memories.columns.column("content").unwrap();
        assert!(matches!(content.column_type, ColumnType::Text));
    }

    #[test]
    fn content_hash_is_native_bytea() {
        let schema = brain_schema(EMBED_DIM);
        let memories = schema.get(&TableName::new(MEMORIES)).unwrap();
        let hash = memories.columns.column("content_hash").unwrap();
        assert!(matches!(hash.column_type, ColumnType::Bytea));
    }

    #[test]
    fn memory_carries_artifact_columns_for_neighbors_citations_and_idempotency() {
        let schema = brain_schema(EMBED_DIM);
        let memories = schema.get(&TableName::new(MEMORIES)).unwrap();
        for col in [
            "owner",
            "stream",
            "author_role",
            "source",
            "seq",
            "line_start",
            "line_end",
            "content_date",
            "content_hash",
            "source_version",
            "normalize_version",
            "veracity",
            "superseded_by",
        ] {
            assert!(
                memories.columns.column(col).is_some(),
                "memory must carry the `{col}` column"
            );
        }
        assert!(
            memories.columns.column("created_at").is_none(),
            "no created_at — UUIDv7 row ids / engine RowProvenance supply write time"
        );
    }

    #[test]
    fn links_carry_all_three_class_column_groups() {
        let schema = brain_schema(EMBED_DIM);
        let links = schema.get(&TableName::new(LINKS)).unwrap();
        for col in [
            "owner",
            "from",
            "to",
            "kind",
            "class",
            "valid_from",
            "valid_to",
            "confidence",
            "strength",
            "stability",
            "access_count",
            "last_access",
            "source_memory",
        ] {
            assert!(
                links.columns.column(col).is_some(),
                "links must carry the `{col}` column"
            );
        }
    }
}
