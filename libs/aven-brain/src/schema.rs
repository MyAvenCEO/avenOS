//! The aven-brain data model as an aven-db [`Schema`].
//!
//! Five tables map 1:1 to the vocabulary (see crate docs): `engrams`, `concepts`,
//! `engram_concepts` (mentions), `facts`, `links`. Embeddings use the first-class
//! [`ColumnType::Vector`] so `nearest` works directly; engram bodies are `Text` so
//! `text_search` (BM25) works directly.

use groove::{ColumnType, Schema, SchemaBuilder, TableSchema, Value};

/// Default embedding dimensionality. EmbeddingGemma-300m's native size; Matryoshka-
/// truncatable to 128/256 for storage savings (the brain picks the dim at build time).
pub const EMBED_DIM: usize = 768;

/// Table names (single source of truth, shared by the schema and the pipeline).
pub const ENGRAMS: &str = "engrams";
pub const CONCEPTS: &str = "concepts";
pub const ENGRAM_CONCEPTS: &str = "engram_concepts";
pub const FACTS: &str = "facts";
pub const LINKS: &str = "links";

/// Build the aven-brain schema for a given embedding dimensionality.
///
/// `embed_dim` must match the embedding model the brain uses; changing it later requires
/// a re-embed + reindex (lens-driven; a future maintenance pass).
pub fn brain_schema(embed_dim: usize) -> Schema {
    SchemaBuilder::new()
        // ── engrams: the atomic memories (verbatim + embedding + tags) ──────────
        .table(
            TableSchema::builder(ENGRAMS)
                .column("content", ColumnType::Text)
                .column("embedding", ColumnType::Vector { dim: embed_dim })
                .nullable_column(
                    "tags",
                    ColumnType::Array {
                        element: Box::new(ColumnType::Text),
                    },
                )
                // ── Provenance + ordering (preserved MemPalace strengths) ───────
                // `source` + `seq` enable neighbor expansion (fetch ±1 sibling
                // engrams from the same source, in order).
                .nullable_column("source", ColumnType::Text)
                .nullable_column("seq", ColumnType::Integer)
                // Surgical line-range citations (MemPalace Tier 6a).
                .nullable_column("line_start", ColumnType::Integer)
                .nullable_column("line_end", ColumnType::Integer)
                // The memory's own time (for temporal-proximity boost + `as_of`),
                // distinct from `created_at` (when it was filed).
                .nullable_column("content_date", ColumnType::Timestamp)
                // Idempotent re-ingest / dedup: a content/source-derived key so the
                // same chunk re-ingested overwrites instead of duplicating.
                .nullable_column("content_hash", ColumnType::Bytea)
                // Incremental ingest: source revision (mtime/etag) to skip unchanged,
                // and a pipeline version to trigger silent rebuilds.
                .nullable_column("source_version", ColumnType::BigInt)
                .column_with_default("normalize_version", ColumnType::Integer, Value::Integer(1))
                .column("created_at", ColumnType::Timestamp)
                // Indexed for cheap dedup lookup + per-source neighbor/incremental scans.
                .index_only(["source", "content_hash"]),
        )
        // ── concepts: named nodes; scoping + graph primitive ────────────────────
        .table(
            TableSchema::builder(CONCEPTS)
                .column("name", ColumnType::Text)
                .column("kind", ColumnType::Text)
                .nullable_column("properties", ColumnType::Json { schema: None })
                .index_only(["name", "kind"]),
        )
        // ── engram_concepts: "mention" edges (engram is about concept) = scope ──
        .table(
            TableSchema::builder(ENGRAM_CONCEPTS)
                .fk_column("engram", ENGRAMS)
                .fk_column("concept", CONCEPTS),
        )
        // ── facts: temporal subject→predicate→object assertions ─────────────────
        .table(
            TableSchema::builder(FACTS)
                .fk_column("subject", CONCEPTS)
                .column("predicate", ColumnType::Text)
                .fk_column("object", CONCEPTS)
                .nullable_column("valid_from", ColumnType::Timestamp)
                .nullable_column("valid_to", ColumnType::Timestamp)
                .column_with_default("confidence", ColumnType::Double, Value::Double(1.0))
                .nullable_fk_column("source_engram", ENGRAMS),
        )
        // ── links: weighted concept↔concept associations carrying salience ──────
        // NOTE: `access_count` should use a Counter merge strategy so co-access sums
        // across devices (Phase 3); the TableSchemaBuilder doesn't expose merge
        // strategies yet, so it is plain LWW for now.
        .table(
            TableSchema::builder(LINKS)
                .fk_column("a", CONCEPTS)
                .fk_column("b", CONCEPTS)
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
        for table in [ENGRAMS, CONCEPTS, ENGRAM_CONCEPTS, FACTS, LINKS] {
            assert!(
                schema.contains_key(&TableName::new(table)),
                "schema must contain table `{table}`"
            );
        }
    }

    #[test]
    fn engram_embedding_is_a_vector_of_the_requested_dim() {
        let schema = brain_schema(256);
        let engrams = schema
            .get(&TableName::new(ENGRAMS))
            .expect("engrams table exists");
        let embedding = engrams
            .columns
            .column("embedding")
            .expect("engrams has an embedding column");
        assert!(
            matches!(embedding.column_type, ColumnType::Vector { dim } if dim == 256),
            "embedding must be Vector {{ dim: 256 }}, got {:?}",
            embedding.column_type
        );
    }

    #[test]
    fn engram_body_is_text_for_bm25() {
        let schema = brain_schema(EMBED_DIM);
        let engrams = schema.get(&TableName::new(ENGRAMS)).unwrap();
        let content = engrams.columns.column("content").unwrap();
        assert!(matches!(content.column_type, ColumnType::Text));
    }

    #[test]
    fn engram_carries_provenance_for_neighbors_citations_and_idempotency() {
        // Restored MemPalace strengths: neighbor expansion (source+seq), surgical
        // citations (line_start/end), content-time, and idempotent dedup (content_hash).
        let schema = brain_schema(EMBED_DIM);
        let engrams = schema.get(&TableName::new(ENGRAMS)).unwrap();
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
                engrams.columns.column(col).is_some(),
                "engram must carry `{col}` provenance/ordering column"
            );
        }
    }
}
