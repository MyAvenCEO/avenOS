//! Per-value cryptographic ownership primitives — Phase 1 of the Ownership & Caps
//! master plan (`libs/aven-board/board/CryptoOwnershipExecutionPlan.md`).
//!
//! Two signed artifacts, both verified **on apply by every peer** (interactive or
//! always-on — there is no client/server split):
//!
//! - [`OwnerBinding`] — "this value belongs to this identity", asserted by the creating
//!   author's device key. It travels in the row's **immutable** authenticated header
//!   (covered by the row digest), so a value cannot be relabeled into another identity
//!   without breaking the signature. This is the single source of truth for ownership —
//!   there is no mutable `owner` column.
//! - [`EditSignature`] — "this batch was authored by this DID", over the batch's
//!   content digest. Binds the (today unsigned) author to crypto.
//!
//! These prove **authenticity + authorship**. Whether the author is *authorized* to bind
//! to / write the identity is a separate biscuit decision ([`crate::caps::authorize`]);
//! [`authorize_signed_edit`] runs all of it together as the inbound apply gate.
//!
//! Single source of truth, shared by every peer (DRY).

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use aven_db::did_key::{ed25519_public_from_signer_did, signer_did_from_ed25519};
use uuid::Uuid;

use crate::caps::{authorize, AccOp, BiscuitVault};

/// Reserved row-metadata key the **owner-binding** travels under (base64). The engine
/// (`aven-db`) defines the same literal in `capability.rs` to read it back as opaque
/// `proof` bytes on apply — they must match. The app stamps it; the resolver decodes it.
pub const OWNER_BINDING_META_KEY: &str = "_owner_binding";
/// Reserved row-metadata key the per-row **edit signature** travels under (base64).
pub const EDIT_SIG_META_KEY: &str = "_edit_sig";

/// Domain separator so an owner-binding signature can never be confused with an edit
/// signature or any other ed25519 signature the device key makes.
const OWNER_BINDING_DOMAIN: &[u8] = b"avenos:owner-binding:v1\0";
const EDIT_SIG_DOMAIN: &[u8] = b"avenos:edit-sig:v1\0";

/// A signed assertion that `value_id` is owned by `owner`, made by `author_did`.
/// Immutable once written: it lives in the row's authenticated header and is covered by
/// the row digest, so it cannot be relabeled without invalidating the signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OwnerBinding {
	pub value_id: Uuid,
	pub owner: Uuid,
	pub author_did: String,
	pub sig: [u8; 64],
}

fn owner_binding_msg(value_id: Uuid, owner: Uuid) -> Vec<u8> {
	let mut m = Vec::with_capacity(OWNER_BINDING_DOMAIN.len() + 32);
	m.extend_from_slice(OWNER_BINDING_DOMAIN);
	m.extend_from_slice(value_id.as_bytes());
	m.extend_from_slice(owner.as_bytes());
	m
}

/// Mint a signed owner-binding for a newly created value, signed with the creating
/// author's device key. The author must *also* hold a biscuit cap chaining to the identity
/// root to be allowed to create identity-owned values — checked separately by [`authorize`]
/// / [`authorize_signed_edit`], so a delegated writer can bind without the identity root key.
pub fn mint_owner_binding(
	author_sk: &SigningKey,
	value_id: Uuid,
	owner: Uuid,
) -> Result<OwnerBinding, String> {
	let author_did = signer_did_from_ed25519(&author_sk.verifying_key().to_bytes())?;
	let sig = author_sk.sign(&owner_binding_msg(value_id, owner));
	Ok(OwnerBinding { value_id, owner, author_did, sig: sig.to_bytes() })
}

/// Verify an owner-binding's signature against the author DID it claims. Does NOT check
/// whether that author was *authorized* to bind to the identity — that is [`authorize`].
pub fn verify_owner_binding(b: &OwnerBinding) -> Result<(), String> {
	let pk = ed25519_public_from_signer_did(&b.author_did)?;
	let vk = VerifyingKey::from_bytes(&pk).map_err(|e| format!("owner-binding-vk:{e}"))?;
	let sig = Signature::from_bytes(&b.sig);
	vk.verify(&owner_binding_msg(b.value_id, b.owner), &sig)
		.map_err(|e| format!("owner-binding-bad-sig:{e}"))
}

impl OwnerBinding {
	/// Compact encoding: `value_id(16) ‖ owner(16) ‖ sig(64) ‖ author_did(utf8)`.
	pub fn encode(&self) -> Vec<u8> {
		let mut v = Vec::with_capacity(96 + self.author_did.len());
		v.extend_from_slice(self.value_id.as_bytes());
		v.extend_from_slice(self.owner.as_bytes());
		v.extend_from_slice(&self.sig);
		v.extend_from_slice(self.author_did.as_bytes());
		v
	}

	pub fn decode(b: &[u8]) -> Result<Self, String> {
		if b.len() < 96 {
			return Err("owner-binding-too-short".into());
		}
		let value_id = Uuid::from_slice(&b[0..16]).map_err(|e| format!("owner-binding-vid:{e}"))?;
		let owner = Uuid::from_slice(&b[16..32]).map_err(|e| format!("owner-binding-identity:{e}"))?;
		let mut sig = [0u8; 64];
		sig.copy_from_slice(&b[32..96]);
		let author_did = String::from_utf8(b[96..].to_vec()).map_err(|e| format!("owner-binding-did:{e}"))?;
		Ok(Self { value_id, owner, author_did, sig })
	}

	/// Base64 (no-pad) form for the row's metadata header (stamped under
	/// [`OWNER_BINDING_META_KEY`]).
	pub fn to_meta_string(&self) -> String {
		STANDARD_NO_PAD.encode(self.encode())
	}

	pub fn from_meta_str(s: &str) -> Result<Self, String> {
		let b = STANDARD_NO_PAD.decode(s.as_bytes()).map_err(|e| format!("owner-binding-b64:{e}"))?;
		Self::decode(&b)
	}
}

/// A signed assertion that a batch (identified by its content digest) was authored by
/// `author_did`. Travels alongside the sealed submission; verified on apply against the
/// digest the *receiver* computes (so a forged digest can't ride along).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditSignature {
	pub author_did: String,
	pub batch_digest: [u8; 32],
	pub sig: [u8; 64],
}

fn edit_sig_msg(batch_digest: &[u8; 32], author_did: &str) -> Vec<u8> {
	let mut m = Vec::with_capacity(EDIT_SIG_DOMAIN.len() + 32 + author_did.len());
	m.extend_from_slice(EDIT_SIG_DOMAIN);
	m.extend_from_slice(batch_digest);
	m.extend_from_slice(author_did.as_bytes());
	m
}

/// Sign a sealed batch's content digest with the author's device key.
pub fn sign_batch(author_sk: &SigningKey, batch_digest: &[u8; 32]) -> Result<EditSignature, String> {
	let author_did = signer_did_from_ed25519(&author_sk.verifying_key().to_bytes())?;
	let sig = author_sk.sign(&edit_sig_msg(batch_digest, &author_did));
	Ok(EditSignature { author_did, batch_digest: *batch_digest, sig: sig.to_bytes() })
}

/// Verify a batch signature against its claimed author and the digest the **receiver**
/// computed (passed as `expected_digest`). Rejects if the carried digest disagrees with
/// what the receiver hashed, or if the signature is invalid.
pub fn verify_signed_batch(s: &EditSignature, expected_digest: &[u8; 32]) -> Result<(), String> {
	if &s.batch_digest != expected_digest {
		return Err("edit-sig-digest-mismatch".into());
	}
	let pk = ed25519_public_from_signer_did(&s.author_did)?;
	let vk = VerifyingKey::from_bytes(&pk).map_err(|e| format!("edit-sig-vk:{e}"))?;
	let sig = Signature::from_bytes(&s.sig);
	vk.verify(&edit_sig_msg(&s.batch_digest, &s.author_did), &sig)
		.map_err(|e| format!("edit-sig-bad-sig:{e}"))
}

impl EditSignature {
	/// Compact encoding: `batch_digest(32) ‖ sig(64) ‖ author_did(utf8)`.
	pub fn encode(&self) -> Vec<u8> {
		let mut v = Vec::with_capacity(96 + self.author_did.len());
		v.extend_from_slice(&self.batch_digest);
		v.extend_from_slice(&self.sig);
		v.extend_from_slice(self.author_did.as_bytes());
		v
	}

	pub fn decode(b: &[u8]) -> Result<Self, String> {
		if b.len() < 96 {
			return Err("edit-sig-too-short".into());
		}
		let mut batch_digest = [0u8; 32];
		batch_digest.copy_from_slice(&b[0..32]);
		let mut sig = [0u8; 64];
		sig.copy_from_slice(&b[32..96]);
		let author_did = String::from_utf8(b[96..].to_vec()).map_err(|e| format!("edit-sig-did:{e}"))?;
		Ok(Self { author_did, batch_digest, sig })
	}

	/// Base64 (no-pad) form for the row's metadata header (stamped under
	/// [`EDIT_SIG_META_KEY`]).
	pub fn to_meta_string(&self) -> String {
		STANDARD_NO_PAD.encode(self.encode())
	}

	pub fn from_meta_str(s: &str) -> Result<Self, String> {
		let b = STANDARD_NO_PAD.decode(s.as_bytes()).map_err(|e| format!("edit-sig-b64:{e}"))?;
		Self::decode(&b)
	}
}

/// The full inbound apply check, run by **every** peer before persisting a received
/// batch: (1) the edit signature is valid for the claimed author over the
/// receiver-computed digest; (2) if an owner-binding is present it is authentic and names
/// this identity; (3) the author is *authorized* for `op` on the resource by the identity's
/// biscuit chain (membership or a per-row grant). All must pass.
#[allow(clippy::too_many_arguments)]
pub fn authorize_signed_edit(
	vault: &BiscuitVault,
	owner: Uuid,
	op: AccOp,
	table: &str,
	row_id: Option<Uuid>,
	edit_sig: &EditSignature,
	expected_digest: &[u8; 32],
	owner_binding: Option<&OwnerBinding>,
) -> Result<(), String> {
	verify_signed_batch(edit_sig, expected_digest)?;
	if let Some(b) = owner_binding {
		verify_owner_binding(b)?;
		if b.owner != owner {
			return Err("owner-binding-identity-mismatch".into());
		}
	}
	authorize(vault, owner, op, table, row_id, &edit_sig.author_did)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::caps::{build_vault_from_signing_key, mint_safe_genesis, BiscuitIdentity};

	fn sk(seed: u8) -> SigningKey {
		SigningKey::from_bytes(&[seed; 32])
	}

	fn owner_vault_with_identity(seed: u8, identity: Uuid) -> BiscuitVault {
		let mut v = build_vault_from_signing_key(&sk(seed)).unwrap();
		let genesis = mint_safe_genesis(&v, identity).unwrap();
		v.safes.insert(identity, BiscuitIdentity { owner: identity, biscuit: genesis });
		v
	}

	#[test]
	fn owner_binding_roundtrip() {
		let b = mint_owner_binding(&sk(1), Uuid::from_u128(0x1111), Uuid::from_u128(0x2222)).unwrap();
		verify_owner_binding(&b).unwrap();
	}

	#[test]
	fn owner_binding_string_roundtrip() {
		let b = mint_owner_binding(&sk(7), Uuid::from_u128(0xAA), Uuid::from_u128(0xBB)).unwrap();
		let back = OwnerBinding::from_meta_str(&b.to_meta_string()).unwrap();
		assert_eq!(b, back);
		verify_owner_binding(&back).unwrap();
	}

	#[test]
	fn edit_sig_meta_string_roundtrip() {
		let s = sign_batch(&sk(7), &[42u8; 32]).unwrap();
		let back = EditSignature::from_meta_str(&s.to_meta_string()).unwrap();
		assert_eq!(s, back);
		verify_signed_batch(&back, &[42u8; 32]).unwrap();
	}

	#[test]
	fn owner_binding_rejects_relabel_to_another_identity() {
		let mut b = mint_owner_binding(&sk(1), Uuid::from_u128(0x1111), Uuid::from_u128(0x2222)).unwrap();
		b.owner = Uuid::from_u128(0x9999); // attacker relabels owner
		assert!(verify_owner_binding(&b).is_err(), "relabel must break the signature");
	}

	#[test]
	fn owner_binding_rejects_forged_author() {
		let mut b = mint_owner_binding(&sk(1), Uuid::from_u128(1), Uuid::from_u128(2)).unwrap();
		b.author_did = signer_did_from_ed25519(&sk(2).verifying_key().to_bytes()).unwrap();
		assert!(verify_owner_binding(&b).is_err(), "claiming a different author must fail");
	}

	#[test]
	fn edit_sig_roundtrip_and_digest_is_bound() {
		let s = sign_batch(&sk(3), &[7u8; 32]).unwrap();
		verify_signed_batch(&s, &[7u8; 32]).unwrap();
		assert!(verify_signed_batch(&s, &[8u8; 32]).is_err(), "wrong receiver digest must fail");
	}

	#[test]
	fn edit_sig_rejects_tamper() {
		let mut s = sign_batch(&sk(3), &[7u8; 32]).unwrap();
		s.sig[0] ^= 0xFF;
		assert!(verify_signed_batch(&s, &[7u8; 32]).is_err());
	}

	#[test]
	fn authorize_signed_edit_owner_writes_own_value() {
		let identity = Uuid::from_u128(0xABCD);
		let v = owner_vault_with_identity(1, identity);
		let value = Uuid::from_u128(0x55);
		let binding = mint_owner_binding(&sk(1), value, identity).unwrap();
		let digest = [9u8; 32];
		let es = sign_batch(&sk(1), &digest).unwrap();
		authorize_signed_edit(&v, identity, AccOp::Write, "todos", Some(value), &es, &digest, Some(&binding))
			.expect("identity owner may write its own value");
	}

	#[test]
	fn authorize_signed_edit_rejects_nonmember_even_with_valid_signature() {
		let identity = Uuid::from_u128(0xABCD);
		let v = owner_vault_with_identity(1, identity); // owner = sk(1)
		let digest = [9u8; 32];
		let es = sign_batch(&sk(2), &digest).unwrap(); // stranger, validly signed
		let r = authorize_signed_edit(&v, identity, AccOp::Write, "todos", None, &es, &digest, None);
		assert!(r.is_err(), "a valid signature from a non-member must still be denied");
	}

	#[test]
	fn edit_sig_apply_rejects_tampered_data() {
		// Audit #29: the edit-sig binds the row's content digest to an authorized author.
		// A relay that mutates `data`/`metadata` in flight changes the digest the RECEIVER
		// computes, so the carried edit-sig (signed over the original digest) no longer
		// matches — `authorize_signed_edit` must reject it. The untampered row is accepted.
		let identity = Uuid::from_u128(0xABCD);
		let v = owner_vault_with_identity(1, identity);
		let value = Uuid::from_u128(0x55);
		let binding = mint_owner_binding(&sk(1), value, identity).unwrap();

		// Author seals a batch and signs the digest the author computed (d0).
		let d0 = [9u8; 32];
		let es = sign_batch(&sk(1), &d0).unwrap();

		// Untampered: receiver recomputes the same digest d0 → accepted.
		authorize_signed_edit(&v, identity, AccOp::Write, "todos", Some(value), &es, &d0, Some(&binding))
			.expect("untampered row whose receiver-digest matches the signed digest is accepted");

		// Tampered: a relay rewrote `data`, so the receiver recomputes a DIFFERENT digest
		// d1 while the edit-sig still carries the signature over d0 → rejected.
		let d1 = [10u8; 32];
		let r = authorize_signed_edit(&v, identity, AccOp::Write, "todos", Some(value), &es, &d1, Some(&binding));
		assert!(
			r.is_err(),
			"a row tampered after signing (receiver-digest != signed digest) must be rejected"
		);
	}

	#[test]
	fn authorize_signed_edit_rejects_owner_binding_for_wrong_identity() {
		let identity = Uuid::from_u128(0xABCD);
		let other = Uuid::from_u128(0xBEEF);
		let v = owner_vault_with_identity(1, identity);
		let binding = mint_owner_binding(&sk(1), Uuid::from_u128(0x55), other).unwrap(); // binds to a different identity
		let digest = [9u8; 32];
		let es = sign_batch(&sk(1), &digest).unwrap();
		let r = authorize_signed_edit(&v, identity, AccOp::Write, "todos", Some(Uuid::from_u128(0x55)), &es, &digest, Some(&binding));
		assert!(r.is_err(), "owner-binding naming a different identity must be rejected");
	}
}
