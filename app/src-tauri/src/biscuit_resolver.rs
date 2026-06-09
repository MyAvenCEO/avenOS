//! Biscuit-backed peer-sync gate — the single authorizer (plan §1.2 / §6).
//!
//! `may_sync(subject, op, resource)` is the one question the engine asks before
//! shipping a batch to a peer. Here it is answered from identity biscuits:
//!   1. subject (`PeerId` = Ed25519 pubkey) → `did:key:`
//!   2. resource `(table, row)` → identity id (via the live `SyncAclSnapshot`)
//!   3. `identity_acc::authorize(vault, identity, op, table, row, peer_did)`
//!
//! Three-state per §1.2: `Pending` (ACL / vault not hydrated yet) DEFERS — it
//! never drops a frame; only an explicit biscuit denial is `DenyPermanent`.
//!
//! Read paths are `std::sync::RwLock` (not tokio) because `may_sync` is sync and
//! runs on the engine tick thread.

use std::sync::{Arc, RwLock};

use groove::{AccOp, CapDecision, CapabilityResolver, EditSigner, ObjectId, ResourceCoord, SyncTargetId};

use crate::jazz::jazz_engine::ShellState;
use crate::identity_sync::SyncAclSnapshot;

/// Live handles shared with the app shell. The app updates these as the vault
/// rehydrates / grants change; the resolver always reads current state.
pub struct BiscuitCapabilityResolver {
	shell: Arc<RwLock<Option<Arc<ShellState>>>>,
	acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
}

impl BiscuitCapabilityResolver {
	pub fn new(
		shell: Arc<RwLock<Option<Arc<ShellState>>>>,
		acl: Arc<RwLock<Option<SyncAclSnapshot>>>,
	) -> Self {
		Self { shell, acl }
	}
}

impl CapabilityResolver for BiscuitCapabilityResolver {
	fn may_sync(&self, subject: &SyncTargetId, op: AccOp, res: &ResourceCoord) -> CapDecision {
		// 1. Subject → peer did:key.
		let peer_did = match subject {
			SyncTargetId::PeerDid(d) => d.clone(),
			SyncTargetId::Client(pid) => match crate::jazz_auth::peer_did_from_ed25519(&pid.0) {
				Ok(did) => did,
				Err(_) => return CapDecision::DenyPermanent,
			},
		};

		// 2. Resource → identity. Missing map = not hydrated yet → DEFER (never drop).
		let Ok(acl_guard) = self.acl.read() else {
			return CapDecision::Pending;
		};
		let Some(acl) = acl_guard.as_ref() else {
			return CapDecision::Pending;
		};

		// 2a. Recipient-scoped keyshare delivery (gated, no chicken-and-egg). A keyshare is
		// E2E-encrypted to exactly ONE recipient, so it may always be forwarded to the peer
		// it names — a self-evident authorization that needs no membership/biscuit eval and
		// never `Pending`s on the owner map. This is what guarantees a grantee deterministically
		// receives its DEK (the held-DEK=[] bug) without the broad ungated bootstrap. It only
		// ever GRANTS delivery to the addressed recipient; it never widens any other access.
		if res.table == "keyshares" {
			if let Some(recipient) = acl.keyshare_recipient.get(&res.row_id) {
				let matched = recipient.trim() == peer_did.trim();
				eprintln!(
					"[SYNCDIAG] may_sync keyshares row={} → peer={} recipient={} matched={}",
					res.row_id.uuid(), peer_did, recipient, matched
				);
				if matched {
					return CapDecision::Allow;
				}
			} else {
				eprintln!(
					"[SYNCDIAG] may_sync keyshares row={} → peer={} NO recipient in acl (fall through to owner-auth)",
					res.row_id.uuid(), peer_did
				);
			}
		}

		let Some(&owner) = acl.object_owner.get(&(res.table.clone(), res.row_id)) else {
			if res.table == "keyshares" || res.table == "identities" {
				eprintln!(
					"[SYNCDIAG] may_sync {} row={} → peer={} PENDING (object_owner not in acl yet)",
					res.table, res.row_id.uuid(), peer_did
				);
			}
			return CapDecision::Pending;
		};

		// 3. Vault not hydrated yet → DEFER.
		let Ok(shell_guard) = self.shell.read() else {
			return CapDecision::Pending;
		};
		let Some(shell) = shell_guard.as_ref() else {
			return CapDecision::Pending;
		};

		// 4. Biscuit decision.
		let identity_op = match op {
			AccOp::Read => crate::identity_acc::AccOp::Read,
			AccOp::Write => crate::identity_acc::AccOp::Write,
			AccOp::Delete => crate::identity_acc::AccOp::Delete,
			AccOp::Replicate => crate::identity_acc::AccOp::Replicate,
		};
		let decision = crate::identity_acc::authorize(
			&shell.vault,
			owner,
			identity_op,
			&res.table,
			Some(*res.row_id.uuid()),
			&peer_did,
		);
		if res.table == "keyshares" || res.table == "identities" {
			eprintln!(
				"[SYNCDIAG] may_sync {} row={} → peer={} owner={} authorize={}",
				res.table, res.row_id.uuid(), peer_did, owner,
				match &decision { Ok(()) => "ALLOW".to_string(), Err(e) => format!("DENY:{e}") }
			);
		}
		match decision {
			Ok(()) => CapDecision::Allow,
			Err(_) => CapDecision::DenyPermanent,
		}
	}

	/// Inbound apply gate (Ownership & Caps master plan, Phase 2). A received row is
	/// accepted only if (1) it carries an authentic **owner-binding** for this row, (2) it
	/// carries an **edit-signature** that binds the digest the receiver computed (covering
	/// `data` + `metadata`) to the author, and (3) that author is authorized for the
	/// identity. This runs on EVERY peer (incl. the always-on server), so a forged,
	/// relabeled, or `data`-tampered row is rejected at apply — not merely withheld outbound
	/// (audit #29: the owner-binding alone covers only `value_id‖owner`, not `data`).
	fn verify_on_apply(
		&self,
		_subject: &SyncTargetId,
		op: AccOp,
		res: &ResourceCoord,
		digest: &[u8; 32],
		proof: Option<&[u8]>,
		edit_sig: Option<&[u8]>,
	) -> CapDecision {
		let spark_scoped = crate::identity_sync::is_spark_scoped_table(&res.table);
		if spark_scoped {
			eprintln!(
				"[GRANTDIAG] verify_on_apply ENTER table={} row_id={} op={:?} owner_binding={} edit_sig={}",
				res.table, res.row_id, op, proof.is_some(), edit_sig.is_some()
			);
		}

		// Private by default: an identity-scoped row MUST carry an owner-binding — **no table
		// exclusions**. Non-identity-scoped tables (local vault/shell, humans) aren't gated
		// here. Control-plane access control is the per-kind cap below (`peers`→`Admit`,
		// `keyshares`→`RotateDek`), not a skip.
		let Some(proof) = proof else {
			if spark_scoped {
				eprintln!("[GRANTDIAG] DENY table={} reason=no_owner_binding", res.table);
				return CapDecision::DenyPermanent;
			}
			return CapDecision::Allow;
		};
		let Ok(meta) = std::str::from_utf8(proof) else {
			return CapDecision::DenyPermanent;
		};
		let binding = match aven_caps::ownership::OwnerBinding::from_meta_str(meta) {
			Ok(b) => b,
			Err(_) => return CapDecision::DenyPermanent,
		};

		// (a) Authenticity — the binding must be for THIS row and validly signed by the
		//     author it names. Needs no vault, so any peer/relay enforces it → a forged
		//     or relabeled row dies at every hop (E2E, relay-proof).
		if binding.value_id != *res.row_id.uuid() {
			eprintln!("[GRANTDIAG] DENY table={} reason=owner_binding_value_id_mismatch", res.table);
			return CapDecision::DenyPermanent;
		}
		if aven_caps::ownership::verify_owner_binding(&binding).is_err() {
			eprintln!("[GRANTDIAG] DENY table={} reason=owner_binding_signature_invalid", res.table);
			return CapDecision::DenyPermanent;
		}

		// Immutable identity: an existing value can't be relabeled into another identity — an
		// update/delete's binding must name the same owner the value was created
		// with (checked against the established ACL; absent = a new value, accepted).
		if let Ok(acl_guard) = self.acl.read() {
			if let Some(acl) = acl_guard.as_ref() {
				if let Some(&existing) = acl.object_owner.get(&(res.table.clone(), res.row_id)) {
					if existing != binding.owner {
						return CapDecision::DenyPermanent;
					}
				}
			}
		}

		// (b) Content integrity — the edit-signature binds the digest the RECEIVER computed
		//     (covering `data` + `metadata`) to the author. Required on identity-scoped rows
		//     (fail-closed); absent = reject. Verified even by a blind relay, so a relay that
		//     rewrote a sealed cell / keyshare column is rejected at the first hop.
		let edit_sig = match edit_sig {
			Some(b) => b,
			None => {
				if spark_scoped {
					eprintln!("[GRANTDIAG] DENY table={} reason=no_edit_sig", res.table);
					return CapDecision::DenyPermanent;
				}
				return CapDecision::Allow;
			}
		};
		let Ok(es_str) = std::str::from_utf8(edit_sig) else {
			eprintln!("[GRANTDIAG] DENY table={} reason=edit_sig_not_utf8", res.table);
			return CapDecision::DenyPermanent;
		};
		let es = match aven_caps::ownership::EditSignature::from_meta_str(es_str) {
			Ok(e) => e,
			Err(_) => {
				eprintln!("[GRANTDIAG] DENY table={} reason=edit_sig_parse_failed", res.table);
				return CapDecision::DenyPermanent;
			}
		};
		// Bind the edit-sig to the receiver-computed digest. A relay that tampered with
		// `data` changes that digest, so the carried signature no longer matches → reject
		// (this holds even when we don't hold the identity, i.e. a pure relay).
		if aven_caps::ownership::verify_signed_batch(&es, digest).is_err() {
			eprintln!(
				"[GRANTDIAG] DENY table={} reason=edit_sig_digest_mismatch (signed digest != receiver-computed digest)",
				res.table
			);
			return CapDecision::DenyPermanent;
		}

		// (c) Authorization — if we hold this identity's biscuit (we're a member), enforce
		//     that the edit-signature's author may actually write it. A blind relay that does
		//     not hold the identity accepts on authenticity + content-integrity alone.
		let Ok(shell_guard) = self.shell.read() else {
			if spark_scoped { eprintln!("[GRANTDIAG] PENDING table={} reason=shell_lock_poisoned", res.table); }
			return CapDecision::Pending;
		};
		let Some(shell) = shell_guard.as_ref() else {
			if spark_scoped { eprintln!("[GRANTDIAG] PENDING table={} reason=no_shell_yet", res.table); }
			return CapDecision::Pending;
		};
		if !shell.vault.identities.contains_key(&binding.owner) {
			if spark_scoped {
				eprintln!(
					"[GRANTDIAG] ALLOW table={} reason=not_yet_member_authenticity_ok owner={}",
					res.table, binding.owner
				);
			}
			return CapDecision::Allow;
		}
		// Honor an inbound Delete (audit #6): a delete-flagged row must satisfy the distinct
		// `Delete` cap, NOT be re-coerced to `Write` by the table mapping — otherwise a peer
		// granted only `write` could hard-delete a victim's row on every member. Non-delete
		// writes keep their per-kind cap (`peers`→`Admit`, `keyshares`→`RotateDek`, else
		// `Write`). The engine derives `op == Delete` from the row's `delete_kind`.
		let required_op = if op == AccOp::Delete {
			crate::identity_acc::AccOp::Delete
		} else {
			required_write_op_for_table(&res.table)
		};
		// Full inbound gate: edit-sig over the receiver digest + owner-binding for this
		// identity + the author holds the cap required for this op/kind. The author is the
		// edit-signature's signer.
		match aven_caps::ownership::authorize_signed_edit(
			&shell.vault,
			binding.owner,
			required_op,
			&res.table,
			Some(binding.value_id),
			&es,
			digest,
			Some(&binding),
		) {
			Ok(()) => {
				eprintln!("[GRANTDIAG] ALLOW table={} reason=authorized_signed_edit", res.table);
				CapDecision::Allow
			}
			Err(e) => {
				eprintln!(
					"[GRANTDIAG] DENY table={} reason=authorize_signed_edit_failed owner={} err={e}",
					res.table, binding.owner
				);
				CapDecision::DenyPermanent
			}
		}
	}
}

/// The cap an inbound **write** to `table` must satisfy. Control-plane row-kinds carry
/// their own access semantics, expressed as caps rather than table exclusions: a
/// `peers` row is a roster admission (`Admit`), a `keyshares` row is DEK management
/// (`RotateDek`); everything else (user data, and `identities` whose author is the genesis
/// owner) is a plain `Write`.
fn required_write_op_for_table(table: &str) -> crate::identity_acc::AccOp {
	match table {
		"peers" => crate::identity_acc::AccOp::Admit,
		"keyshares" => crate::identity_acc::AccOp::RotateDek,
		_ => crate::identity_acc::AccOp::Write,
	}
}

/// App-side author **edit-signer** (audit #29). Installed via
/// [`groove::AvenosClient::set_edit_signer`]; the engine invokes it from the local write
/// path with each assembled row's content digest. It signs that digest with the device key
/// so `data` + `metadata` are authenticated end-to-end and rejected on apply by every peer
/// if tampered in flight. The digest excludes the edit-sig slot, so stamping is digest-safe.
pub struct AppEditSigner {
	signing_key: ed25519_dalek::SigningKey,
}

impl AppEditSigner {
	pub fn new(signing_key: ed25519_dalek::SigningKey) -> Self {
		Self { signing_key }
	}
}

impl EditSigner for AppEditSigner {
	fn sign_row(&self, _row_id: ObjectId, digest: &[u8; 32]) -> Option<(String, String)> {
		let es = aven_caps::ownership::sign_batch(&self.signing_key, digest).ok()?;
		Some((
			aven_caps::ownership::EDIT_SIG_META_KEY.to_string(),
			es.to_meta_string(),
		))
	}
}
