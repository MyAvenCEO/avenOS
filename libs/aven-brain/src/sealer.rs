//! The sealing seam (board 0021) — "sealing is an app-layer concern".
//!
//! The brain seals every non-routing cell before write and opens on read; the
//! crypto comes in through this trait, mirroring [`crate::embedder::Embedder`].
//! One concrete implementation, [`KeySealer`], serves both worlds: tests build it
//! from a random key ([`KeySealer::random`]), the app from the identity's DEK —
//! byte-identical to the device seal path (`cell_seal_aad` coordinates: urn ·
//! table · column · row · dek_version · storage slug), so the app's hydrate /
//! DB viewer opens brain-sealed cells like any other sealed cell.
//!
//! The dedup key is NOT a seal: `dedup_mac` is a keyed PRF over the content
//! (HKDF-Expand(DEK-derived key, content)) — equality-searchable by members
//! (DB-level `filter_eq`), opaque to the disk and the blind relay.

use aven_caps::crypto::{cell_seal_aad, column_type_slug, open_text_cell_payload, seal_text_cell_payload};
use aven_db::ColumnType;
use hkdf::Hkdf;
use sha2::Sha256;
use uuid::Uuid;

/// Seals/opens one SAFE's brain cells. Implementations hold the key material and
/// the AAD context (owner urn + DEK version); the brain supplies the coordinates.
pub trait Sealer: Send + Sync {
    /// AEAD-seal `plaintext` bound to `(table, column, row)`.
    fn seal(&self, table: &str, column: &str, row: Uuid, plaintext: &str) -> Result<String, String>;
    /// Open a sealed cell — same coordinates or it fails (AEAD).
    fn open(&self, table: &str, column: &str, row: Uuid, sealed: &str) -> Result<String, String>;
    /// Keyed MAC for the content-dedup column (plaintext routing, member-only meaning).
    fn dedup_mac(&self, content: &str) -> Vec<u8>;
    /// Short name for traces.
    fn name(&self) -> &'static str;
}

/// The one concrete sealer: 32-byte key + AAD context. Tests use a random key;
/// the app passes the identity's DEK + live urn/version.
pub struct KeySealer {
    key: [u8; 32],
    /// Owner urn, e.g. `safe:<identity-uuid>` — must match the device seal path.
    urn: String,
    dek_version: i64,
}

impl KeySealer {
    pub fn new(key: [u8; 32], owner: Uuid, dek_version: i64) -> Self {
        Self {
            key,
            urn: format!("safe:{owner}"),
            dek_version,
        }
    }

    /// Random-key sealer for tests / ephemeral brains. Nothing else can open it.
    pub fn random(owner: Uuid) -> Self {
        use rand_core::{OsRng, RngCore};
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        Self::new(key, owner, 1)
    }

    fn aad(&self, table: &str, column: &str, row: Uuid) -> Vec<u8> {
        // All sealed brain storage is text — the slug must equal what the app's
        // hydrate derives from the manifest storage type.
        cell_seal_aad(
            &self.urn,
            table,
            column,
            row,
            self.dek_version,
            column_type_slug(&ColumnType::Text),
        )
    }
}

impl Sealer for KeySealer {
    fn seal(&self, table: &str, column: &str, row: Uuid, plaintext: &str) -> Result<String, String> {
        seal_text_cell_payload(&self.key, &self.aad(table, column, row), plaintext)
    }

    fn open(&self, table: &str, column: &str, row: Uuid, sealed: &str) -> Result<String, String> {
        let (plaintext, _ver) = open_text_cell_payload(&self.key, sealed, &self.aad(table, column, row))?;
        Ok(plaintext)
    }

    fn dedup_mac(&self, content: &str) -> Vec<u8> {
        // HKDF-Expand is HMAC under the hood: a keyed PRF over the content. The
        // domain string separates this key line from every other DEK derivation.
        let hk = Hkdf::<Sha256>::new(None, &self.key);
        let mut out = [0u8; 32];
        hk.expand_multi_info(&[b"aven-brain dedup v1:", content.as_bytes()], &mut out)
            .expect("32 bytes is a valid hkdf length");
        out.to_vec()
    }

    fn name(&self) -> &'static str {
        "key-aead"
    }
}
