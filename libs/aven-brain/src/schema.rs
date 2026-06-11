//! The aven-brain data model as an aven-db [`Schema`] — **three tables**:
//! `memories` · `entities` · `links` (see the v5 plan, board `plan/0018`).
//!
//! Mirrors `libs/aven-schema/schema.manifest.json` exactly (avenDB storage types), so the
//! same brain code runs over the lib's own store (tests) and the app's manifest-built
//! store. Sealed-at-rest columns are declared `Text`/`Bytea` per the app convention;
//! sealing itself is an app-layer concern.
//!
//! No `created_at`/`updated_at` columns anywhere: row [`aven_db::ObjectId`]s are UUIDv7
//! (time-ordered) and the engine's `RowProvenance` carries authorship — engine built-ins
//! are never duplicated (plan §2.1).

use aven_db::{ColumnType, Schema, SchemaBuilder, TableSchema};

/// Default embedding dimensionality. EmbeddingGemma-300m's native size; Matryoshka-
/// truncatable to 128/256 for storage savings (the brain picks the dim at build time).
pub const EMBED_DIM: usize = 768;

/// Table names (single source of truth, shared by the schema and the pipeline).
pub const MEMORIES: &str = "memories";
pub const ENTITIES: &str = "entities";
pub const LINKS: &str = "links";

/// Build the aven-brain schema (board 0021: sealed at rest — every non-routing column
/// is Text storage holding a sealed AEAD payload; only `owner` and the keyed-MAC
/// `content_hash` are plaintext routing).
///
/// `_embed_dim` is the embedder's dimensionality — the sealed embedding payload carries
/// packed f32s of that length; the storage type no longer encodes it.
pub fn brain_schema(_embed_dim: usize) -> Schema {
    SchemaBuilder::new()
        // ── memories: evidence — verbatim content + embedding + artifact columns ──
        .table(
            TableSchema::builder(MEMORIES)
                // routing — one brain per SAFE; every query is owner-scoped.
                .column("owner", ColumnType::Uuid)
                .column("content", ColumnType::Text)
                // Sealed packed-f32 embedding (base64 inside the AEAD payload). The
                // dim lives in the payload, not the storage type — sealed cells are text.
                .nullable_column("embedding", ColumnType::Text)
                // Artifact columns (the memory's origin, denormalized): surface, author
                // kind, origin row + position within it. All sealed.
                .column("stream", ColumnType::Text)
                .column("author_role", ColumnType::Text)
                .nullable_column("source", ColumnType::Text)
                // Sealed numbers ride as decimal strings inside the payload.
                .nullable_column("seq", ColumnType::Text)
                .nullable_column("line_start", ColumnType::Text)
                .nullable_column("line_end", ColumnType::Text)
                // Domain time (when the content happened) — ms-since-epoch, sealed.
                .nullable_column("content_date", ColumnType::Text)
                // Keyed-MAC dedup key (HKDF(DEK)-PRF over content): plaintext ROUTING —
                // equality-searchable by members, opaque to disk and the blind relay.
                .nullable_column("content_hash", ColumnType::Bytea)
                .nullable_column("source_version", ColumnType::Text)
                .nullable_column("normalize_version", ColumnType::Text)
                // Trust class: stated | inferred | imported | tool | unknown. Sealed.
                .nullable_column("veracity", ColumnType::Text)
                // Re-weighting, never deletion: replacement memory row id; the hot path
                // filters `IS NULL` (null-ness is metadata — works on sealed columns).
                .nullable_column("superseded_by", ColumnType::Text)
                // Indexes only over plaintext routing — indexing ciphertext is noise.
                .index_only(["owner", "content_hash"]),
        )
        // ── entities: pure interpretation — names with NO backing artifact row ───
        .table(
            TableSchema::builder(ENTITIES)
                .column("owner", ColumnType::Uuid)
                .column("name", ColumnType::Text)
                .column("kind", ColumnType::Text)
                // JSON rides as a sealed text payload.
                .nullable_column("properties", ColumnType::Text)
                .index_only(["owner"]),
        )
        // ── links: the one edge primitive — endpoints are ANY row ids ────────────
        // NOTE: `access_count` should use a Counter merge strategy so co-access sums
        // across devices; the TableSchemaBuilder doesn't expose merge strategies yet,
        // so it is plain LWW for now. Everything but `owner` is sealed — the graph
        // topology itself is content, not routing.
        .table(
            TableSchema::builder(LINKS)
                .column("owner", ColumnType::Uuid)
                // Row id strings (memory / entity / artifact row), sealed.
                .column("from", ColumnType::Text)
                .column("to", ColumnType::Text)
                // Registered kind; its class decides merge semantics (law 6). Sealed.
                .column("kind", ColumnType::Text)
                .column("class", ColumnType::Text)
                // claim: validity window (ms-since-epoch) + Bayesian confidence. Sealed.
                .nullable_column("valid_from", ColumnType::Text)
                .nullable_column("valid_to", ColumnType::Text)
                .nullable_column("confidence", ColumnType::Text)
                // bond: dynamics (Hebbian potentiation + Ebbinghaus decay). Sealed.
                .nullable_column("strength", ColumnType::Text)
                .nullable_column("stability", ColumnType::Text)
                .nullable_column("access_count", ColumnType::Text)
                .nullable_column("last_access", ColumnType::Text)
                // evidence: the memory row a claim was extracted from. Sealed.
                .nullable_column("source_memory", ColumnType::Text)
                .index_only(["owner"]),
        )
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aven_db::TableName;

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
    fn memory_embedding_is_sealed_text_storage() {
        // Board 0021: sealed at rest — the embedding is an AEAD payload string
        // (packed f32 inside), never a native plaintext Vector on disk.
        let schema = brain_schema(256);
        let memories = schema
            .get(&TableName::new(MEMORIES))
            .expect("memories table exists");
        let embedding = memories
            .columns
            .column("embedding")
            .expect("memories has an embedding column");
        assert!(
            matches!(embedding.column_type, ColumnType::Text),
            "embedding must be sealed Text storage, got {:?}",
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
