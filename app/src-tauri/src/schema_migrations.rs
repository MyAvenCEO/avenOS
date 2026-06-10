//! AvenDb v2-style local schema migrations: lenses between schema hashes, no full DB wipe.
//!
//! See <https://jazz.tools/docs/schemas/migrations> and `libs/aven-schema/migrations/`.

use std::fs;
use std::path::{Path, PathBuf};

use aven_db::query_manager::types::{Schema, SchemaHash};
use aven_db::schema_manager::auto_lens::generate_lens;
use serde::Deserialize;

use crate::schema_manifest;

const SNAPSHOTS_SUBDIR: &str = "schema_snapshots";

#[derive(Debug, Deserialize)]
struct MigrationRegistry {
	snapshots: Vec<RegistrySnapshot>,
}

#[derive(Debug, Deserialize)]
struct RegistrySnapshot {
	hash: String,
	manifest: String,
}

fn registry_path() -> PathBuf {
	schema_manifest::aven_schema_root().join("migrations/registry.json")
}

pub fn schema_hash_bytes(schema: &Schema) -> [u8; 32] {
	*SchemaHash::compute(schema).as_bytes()
}

pub fn hash_hex(bytes: &[u8; 32]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn load_registry() -> Result<MigrationRegistry, String> {
	let raw = fs::read_to_string(registry_path())
		.map_err(|e| format!("read {}: {e}", registry_path().display()))?;
	serde_json::from_str(&raw).map_err(|e| format!("registry JSON: {e}"))
}

fn bundled_manifest_for_hash(hash: &[u8; 32]) -> Option<PathBuf> {
	let reg = load_registry().ok()?;
	let want = hash_hex(hash);
	for snap in reg.snapshots {
		if snap.hash.trim().eq_ignore_ascii_case(&want) {
			return Some(schema_manifest::aven_schema_root().join(snap.manifest));
		}
	}
	None
}

fn vault_snapshot_path(data_dir: &Path, hash: &[u8; 32]) -> PathBuf {
	data_dir
		.join(SNAPSHOTS_SUBDIR)
		.join(format!("{}.manifest.json", hash_hex(hash)))
}

/// Persist manifest JSON for a schema hash (per-vault history).
pub fn persist_vault_snapshot(data_dir: &Path, hash: &[u8; 32], manifest_src: &Path) -> Result<(), String> {
	let dir = data_dir.join(SNAPSHOTS_SUBDIR);
	fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
	let dest = vault_snapshot_path(data_dir, hash);
	fs::copy(manifest_src, &dest).map_err(|e| format!("copy snapshot {}: {e}", dest.display()))?;
	Ok(())
}

fn load_schema_for_hash(data_dir: &Path, hash: &[u8; 32]) -> Result<Option<Schema>, String> {
	let vault_path = vault_snapshot_path(data_dir, hash);
	if vault_path.is_file() {
		return schema_manifest::load_avendb_schema_from_manifest_path(&vault_path).map(Some);
	}
	if let Some(bundled) = bundled_manifest_for_hash(hash) {
		if bundled.is_file() {
			let _ = persist_vault_snapshot(data_dir, hash, &bundled);
			return schema_manifest::load_avendb_schema_from_manifest_path(&bundled).map(Some);
		}
	}
	Ok(None)
}

/// When on-disk schema hash differs from current manifest, return prior [`Schema`] versions to
/// register as live schemas (AvenDb lenses) instead of wiping avenDB data.
pub fn live_schemas_for_stored_hash(
	data_dir: &Path,
	stored_hash: &[u8; 32],
	current: &Schema,
) -> Result<Vec<Schema>, String> {
	let current_hash = schema_hash_bytes(current);
	if stored_hash == &current_hash {
		return Ok(Vec::new());
	}

	let Some(old) = load_schema_for_hash(data_dir, stored_hash)? else {
		return Err(format!(
			"unknown schema hash {} — no snapshot in {} or bundled registry; cannot migrate safely",
			hex_short(stored_hash),
			vault_snapshot_path(data_dir, stored_hash).display()
		));
	};

	let lens = generate_lens(&old, current);
	if lens.is_draft() {
		return Err(format!(
			"auto lens {} → {} is a draft (ambiguous rename?); add an explicit migration under libs/aven-schema/migrations/",
			hex_short(stored_hash),
			hex_short(&current_hash)
		));
	}

	log::info!(
		target: "avenos::avendb",
		"schema migration lens {} → {} (keeping avenDB data)",
		hex_short(stored_hash),
		hex_short(&current_hash)
	);

	Ok(vec![old])
}

fn hex_short(bytes: &[u8]) -> String {
	let n = bytes.len().min(6);
	bytes.iter().take(n).map(|b| format!("{b:02x}")).collect()
}

/// After a successful connect, stamp the current manifest into the vault snapshot dir.
pub fn stamp_current_vault_snapshot(data_dir: &Path, current: &Schema) -> Result<(), String> {
	let hash = schema_hash_bytes(current);
	let manifest = schema_manifest::aven_schema_manifest_path();
	persist_vault_snapshot(data_dir, &hash, &manifest)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn current_manifest_has_stable_hash() {
		let schema = schema_manifest::load_avendb_schema_from_manifest().unwrap();
		let h = schema_hash_bytes(&schema);
		assert_eq!(hash_hex(&h).len(), 64);
	}

	/// Every bundled snapshot in `registry.json` must lens cleanly to the current
	/// manifest (no draft = no ambiguous rename). This catches a manifest change
	/// that would force a wipe/error on existing vaults *at test time*, not at the
	/// user's unlock. Add a `before-<feature>` snapshot + registry entry for each
	/// shippable schema change (see `libs/aven-schema/migrations/README.md`).
	#[test]
	fn registry_snapshots_lens_cleanly_to_current() {
		let reg = load_registry().expect("load registry.json");
		let current = schema_manifest::load_avendb_schema_from_manifest().expect("current manifest");
		let root = schema_manifest::aven_schema_root();
		for snap in &reg.snapshots {
			let path = root.join(&snap.manifest);
			let old = schema_manifest::load_avendb_schema_from_manifest_path(&path)
				.unwrap_or_else(|e| panic!("load snapshot {}: {e}", snap.manifest));
			// The registry hash must actually match the snapshot it points at.
			assert_eq!(
				hash_hex(&schema_hash_bytes(&old)),
				snap.hash.to_lowercase(),
				"registry hash mismatch for {}",
				snap.manifest
			);
			let lens = generate_lens(&old, &current);
			assert!(
				!lens.is_draft(),
				"snapshot {} → current is a draft lens (ambiguous rename?); make the change add-only \
				 or add an explicit migration",
				snap.manifest
			);
		}
	}
}
