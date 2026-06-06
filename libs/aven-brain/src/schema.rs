//! The aven-brain data model as an aven-db [`Schema`].
//!
//! Five tables map 1:1 to the vocabulary (see crate docs): `memories`, `entities`,
//! `memory_entities` (mentions), `facts`, `relations`. Embeddings use the first-class
//! [`ColumnType::Vector`] so `nearest` works directly; memory bodies are `Text` so
//! `text_search` (BM25) works directly; `content_hash` uses native `Bytea`.

use groove::{ColumnType, Schema, SchemaBuilder, TableSchema, Value};

/// Default embedding dimensionality. EmbeddingGemma-300m's native size; Matryoshka-
/// truncatable to 128/256 for storage savings (the brain picks the dim at build time).
pub const EMBED_DIM: usize = 768;

/// Table names (single source of truth, shared by the schema and the pipeline).
pub const MEMORIES: &str = "memories";
pub const ENTITIES: &str = "entities";
pub const MEMORY_ENTITIES: &str = "memory_entities";
pub const FACTS: &str = "facts";
pub const RELATIONS: &str = "relations";

/// Build the aven-brain schema for a given embedding dimensionality.
///
/// `embed_dim` must match the embedding model the brain uses; changing it later requires
/// a re-embed + reindex (lens-driven; a future maintenance pass).
pub fn brain_schema(embed_dim: usize) -> Schema {
    SchemaBuilder::new()
        // ── memories: the atomic units (verbatim + embedding + tags + provenance) ──
        .table(
            TableSchema::builder(MEMORIES)
                .column("content", ColumnType::Text)
                // First-class native vector column (powers `nearest`).
                .column("embedding", ColumnType::Vector { dim: embed_dim })
                .nullable_column(
                    "tags",
                    ColumnType::Array {
                        element: Box::new(ColumnType::Text),
                    },
                )
                // Provenance + ordering (preserved MemPalace strengths):
                // `source` + `seq` -> neighbor expansion (±1 sibling memories, in order).
                .nullable_column("source", ColumnType::Text)
                .nullable_column("seq", ColumnType::Integer)
                // Surgical line-range citations (MemPalace Tier 6a).
                .nullable_column("line_start", ColumnType::Integer)
                .nullable_column("line_end", ColumnType::Integer)
                // The memory's own time (temporal-proximity boost + `as_of`), distinct
                // from `created_at` (when it was filed).
                .nullable_column("content_date", ColumnType::Timestamp)
                // Idempotent re-ingest / dedup key (native `Bytea`, e.g. a content digest).
                .nullable_column("content_hash", ColumnType::Bytea)
                // Incremental ingest: source revision (mtime/etag) + pipeline version.
                .nullable_column("source_version", ColumnType::BigInt)
                .column_with_default("normalize_version", ColumnType::Integer, Value::Integer(1))
                .column("created_at", ColumnType::Timestamp)
                .index_only(["source", "content_hash"]),
        )
        // ── entities: named nodes; the semantic graph primitive ─────────────────
        .table(
            TableSchema::builder(ENTITIES)
                .column("name", ColumnType::Text)
                .column("kind", ColumnType::Text)
                .nullable_column("properties", ColumnType::Json { schema: None })
                .index_only(["name", "kind"]),
        )
        // ── memory_entities: "mention" edges (which entities a memory references) ─
        .table(
            TableSchema::builder(MEMORY_ENTITIES)
                .fk_column("memory", MEMORIES)
                .fk_column("entity", ENTITIES),
        )
        // ── facts: temporal subject→predicate→object assertions between entities ─
        .table(
            TableSchema::builder(FACTS)
                .fk_column("subject", ENTITIES)
                .column("predicate", ColumnType::Text)
                .fk_column("object", ENTITIES)
                .nullable_column("valid_from", ColumnType::Timestamp)
                .nullable_column("valid_to", ColumnType::Timestamp)
                .column_with_default("confidence", ColumnType::Double, Value::Double(1.0))
                .nullable_fk_column("source_memory", MEMORIES),
        )
        // ── relations: weighted entity↔entity associations carrying dynamics ─
        //    (strength / stability / decay — Hebbian potentiation + Ebbinghaus decay)
        // NOTE: `access_count` should use a Counter merge strategy so co-access sums
        // across devices (Phase 3); the TableSchemaBuilder doesn't expose merge
        // strategies yet, so it is plain LWW for now.
        .table(
            TableSchema::builder(RELATIONS)
                .fk_column("a", ENTITIES)
                .fk_column("b", ENTITIES)
                .column_with_default("strength", ColumnType::Double, Value::Double(1.0))
                .column_with_default("stability", ColumnType::Double, Value::Double(1.0))
                .column_with_default("access_count", ColumnType::BigInt, Value::BigInt(0))
                .column("last_access", ColumnType::Timestamp),
        )
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use groove::TableName;

    #[test]
    fn brain_schema_has_all_five_tables() {
        let schema = brain_schema(EMBED_DIM);
        for table in [MEMORIES, ENTITIES, MEMORY_ENTITIES, FACTS, RELATIONS] {
            assert!(
                schema.contains_key(&TableName::new(table)),
                "schema must contain table `{table}`"
            );
        }
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
    fn memory_carries_provenance_for_neighbors_citations_and_idempotency() {
        let schema = brain_schema(EMBED_DIM);
        let memories = schema.get(&TableName::new(MEMORIES)).unwrap();
        for col in [
            "source",
            "seq",
            "line_start",
            "line_end",
            "content_date",
            "content_hash",
            "source_version",
            "normalize_version",
        ] {
            assert!(
                memories.columns.column(col).is_some(),
                "memory must carry `{col}` provenance/ordering column"
            );
        }
    }
}
