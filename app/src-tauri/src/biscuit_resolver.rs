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
				if recipient.trim() == peer_did.trim() {
					return CapDecision::Allow;
				}
			}
		}

		let Some(&owner) = acl.object_owner.get(&(res.table.clone(), res.row_id)) else {
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
		match crate::identity_acc::authorize(
			&shell.vault,
			owner,
			identity_op,
			&res.table,
			Some(*res.row_id.uuid()),
			&peer_did,
		) {
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

		// Private by default: an identity-scoped row MUST carry an owner-binding — **no table
		// exclusions**. Non-identity-scoped tables (local vault/shell, humans) aren't gated
		// here. Control-plane access control is the per-kind cap below (`peers`→`Admit`,
		// `keyshares`→`RotateDek`), not a skip.
		let Some(proof) = proof else {
			if spark_scoped {
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
			return CapDecision::DenyPermanent;
		}
		if aven_caps::ownership::verify_owner_binding(&binding).is_err() {
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
					return CapDecision::DenyPermanent;
				}
				return CapDecision::Allow;
			}
		};
		let Ok(es_str) = std::str::from_utf8(edit_sig) else {
			return CapDecision::DenyPermanent;
		};
		let es = match aven_caps::ownership::EditSignature::from_meta_str(es_str) {
			Ok(e) => e,
			Err(_) => {
				return CapDecision::DenyPermanent;
			}
		};
		// Bind the edit-sig to the receiver-computed digest. A relay that tampered with
		// `data` changes that digest, so the carried signature no longer matches → reject
		// (this holds even when we don't hold the identity, i.e. a pure relay).
		if aven_caps::ownership::verify_signed_batch(&es, digest).is_err() {
			return CapDecision::DenyPermanent;
		}

		// (c) Authorization — if we hold this identity's biscuit (we're a member), enforce
		//     that the edit-signature's author may actually write it. A blind relay that does
		//     not hold the identity accepts on authenticity + content-integrity alone.
		let Ok(shell_guard) = self.shell.read() else {
			return CapDecision::Pending;
		};
		let Some(shell) = shell_guard.as_ref() else {
			return CapDecision::Pending;
		};
		if !shell.vault.identities.contains_key(&binding.owner) {
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
			Ok(()) => CapDecision::Allow,
			Err(_) => CapDecision::DenyPermanent,
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

#[cfg(test)]
mod tests {
	use super::*;
	use std::collections::HashMap;

	use aven_caps::caps::{
		attenuate_add_owner_third_party, attenuate_add_reader_third_party,
		build_vault_from_signing_key, mint_genesis_identity, rebuild_identity_biscuit_excluding,
		BiscuitIdentity, BiscuitVault,
	};
	use aven_caps::ownership::mint_owner_binding;
	use ed25519_dalek::SigningKey;
	use groove::{AccOp, CapDecision, ObjectId, ResourceCoord, SyncTargetId};
	use uuid::Uuid;

	use crate::identity_sync::{build_sync_acl_snapshot, SyncAclSnapshot};
	use crate::jazz::jazz_engine::ShellState;

	// ── test helpers ─────────────────────────────────────────────────────────

	fn make_vault(root: &[u8; 32]) -> BiscuitVault {
		build_vault_from_signing_key(&SigningKey::from_bytes(root)).unwrap()
	}

	/// Wrap a vault in the Arc<ShellState> the resolver expects. Only `vault` is
	/// consulted by may_sync / verify_on_apply; the other fields are inert.
	fn make_shell(vault: BiscuitVault) -> Arc<ShellState> {
		let peer_did = vault.peer_did.clone();
		Arc::new(ShellState {
			peer_did,
			vault,
			signing_key: SigningKey::from_bytes(&[0xcc; 32]),
			default_identity: Uuid::nil(),
			deks: HashMap::new(),
			identity_versions: HashMap::new(),
			groove_write_branch: "main".into(),
		})
	}

	fn make_resolver(
		shell: Option<Arc<ShellState>>,
		acl: Option<SyncAclSnapshot>,
	) -> BiscuitCapabilityResolver {
		BiscuitCapabilityResolver::new(
			Arc::new(RwLock::new(shell)),
			Arc::new(RwLock::new(acl)),
		)
	}

	fn make_res(table: &str, row_id: Uuid) -> ResourceCoord {
		ResourceCoord::new("", table, ObjectId::from_uuid(row_id))
	}

	fn acl_with_row(table: &str, row_id: Uuid, identity: Uuid) -> SyncAclSnapshot {
		let mut map = HashMap::new();
		map.insert((table.into(), ObjectId::from_uuid(row_id)), identity);
		build_sync_acl_snapshot(map, HashMap::new())
	}

	fn dummy_digest() -> [u8; 32] {
		[0u8; 32]
	}
	fn dummy_subject() -> SyncTargetId {
		SyncTargetId::PeerDid("did:key:unused".into())
	}

	// ── may_sync: defer / pending paths ──────────────────────────────────────

	#[test]
	fn may_sync_pending_when_acl_unhydrated() {
		let resolver = make_resolver(None, None);
		let res = make_res("todos", Uuid::new_v4());
		assert_eq!(
			resolver.may_sync(&SyncTargetId::PeerDid("did:key:x".into()), AccOp::Read, &res),
			CapDecision::Pending,
			"unhydrated ACL must defer, never drop"
		);
	}

	#[test]
	fn may_sync_pending_when_shell_unhydrated() {
		let row = Uuid::new_v4();
		let sid = Uuid::new_v4();
		let resolver = make_resolver(None, Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.may_sync(&SyncTargetId::PeerDid("did:key:x".into()), AccOp::Read, &res),
			CapDecision::Pending,
			"unhydrated shell must defer"
		);
	}

	#[test]
	fn may_sync_pending_when_row_absent_from_acl() {
		let v = make_vault(&[1u8; 32]);
		let peer_did = v.peer_did.clone();
		// ACL is present but contains no mapping for this row.
		let resolver =
			make_resolver(Some(make_shell(v)), Some(build_sync_acl_snapshot(HashMap::new(), HashMap::new())));
		let res = make_res("todos", Uuid::new_v4());
		assert_eq!(
			resolver.may_sync(&SyncTargetId::PeerDid(peer_did), AccOp::Read, &res),
			CapDecision::Pending,
			"row absent from ACL must defer, not deny"
		);
	}

	// ── may_sync: allow / deny decision paths ────────────────────────────────

	#[test]
	fn may_sync_owner_read_and_write_allowed() {
		let mut v = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&v, sid).unwrap();
		let peer_did = v.peer_did.clone();
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		let resolver =
			make_resolver(Some(make_shell(v)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		let subject = SyncTargetId::PeerDid(peer_did);

		assert_eq!(resolver.may_sync(&subject, AccOp::Read, &res), CapDecision::Allow);
		assert_eq!(resolver.may_sync(&subject, AccOp::Write, &res), CapDecision::Allow);
	}

	#[test]
	fn may_sync_unknown_peer_denied_permanently() {
		let mut v = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&v, sid).unwrap();
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		let resolver =
			make_resolver(Some(make_shell(v)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		let intruder = make_vault(&[99u8; 32]);
		assert_eq!(
			resolver.may_sync(&SyncTargetId::PeerDid(intruder.peer_did), AccOp::Read, &res),
			CapDecision::DenyPermanent,
			"unrecognised DID must be denied"
		);
	}

	#[test]
	fn may_sync_reader_can_read_but_not_write() {
		let mut owner = make_vault(&[1u8; 32]);
		let reader = make_vault(&[2u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let genesis = mint_genesis_identity(&owner, sid).unwrap();
		let chain = attenuate_add_reader_third_party(
			&owner.biscuit_kp,
			&genesis,
			sid,
			&reader.peer_did,
		)
		.unwrap();
		owner.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		let resolver =
			make_resolver(Some(make_shell(owner)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		let subject = SyncTargetId::PeerDid(reader.peer_did);
		assert_eq!(resolver.may_sync(&subject, AccOp::Read, &res), CapDecision::Allow);
		assert_eq!(
			resolver.may_sync(&subject, AccOp::Write, &res),
			CapDecision::DenyPermanent
		);
	}

	/// Regression for commit `80455a1`: revoke-then-regrant must restore access.
	/// Before that fix `rebuild_identity_biscuit_excluding` silently stripped ALL
	/// non-owner grants when revoking any one peer, so a regrant immediately after a
	/// revoke would still show the re-granted member as denied.
	#[test]
	fn may_sync_revoke_and_regrant_cycle() {
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let root_owner = [1u8; 32];
		let root_member = [2u8; 32];
		let root_outsider = [3u8; 32];

		// ── phase 1: grant member, then revoke → member denied ───────────────
		{
			let mut owner = make_vault(&root_owner);
			let member = make_vault(&root_member);
			let genesis = mint_genesis_identity(&owner, sid).unwrap();
			let granted = attenuate_add_reader_third_party(
				&owner.biscuit_kp,
				&genesis,
				sid,
				&member.peer_did,
			)
			.unwrap();
			owner.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: granted });
			let revoked = rebuild_identity_biscuit_excluding(&owner, sid, &member.peer_did).unwrap();
			owner.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: revoked });
			let resolver =
				make_resolver(Some(make_shell(owner)), Some(acl_with_row("todos", row, sid)));
			assert_eq!(
				resolver.may_sync(
					&SyncTargetId::PeerDid(member.peer_did),
					AccOp::Read,
					&make_res("todos", row)
				),
				CapDecision::DenyPermanent,
				"revoked member must be denied"
			);
		}

		// ── phase 2: fresh regrant → member allowed ───────────────────────────
		{
			let mut owner = make_vault(&root_owner); // same root → same DID
			let member = make_vault(&root_member);
			let outsider = make_vault(&root_outsider);
			let genesis = mint_genesis_identity(&owner, sid).unwrap();
			let regranted = attenuate_add_reader_third_party(
				&owner.biscuit_kp,
				&genesis,
				sid,
				&member.peer_did,
			)
			.unwrap();
			owner.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: regranted });
			let resolver =
				make_resolver(Some(make_shell(owner)), Some(acl_with_row("todos", row, sid)));
			assert_eq!(
				resolver.may_sync(
					&SyncTargetId::PeerDid(member.peer_did),
					AccOp::Read,
					&make_res("todos", row)
				),
				CapDecision::Allow,
				"regrant must restore access"
			);
			assert_eq!(
				resolver.may_sync(
					&SyncTargetId::PeerDid(outsider.peer_did),
					AccOp::Read,
					&make_res("todos", row)
				),
				CapDecision::DenyPermanent,
				"outsider must remain denied after regrant"
			);
		}
	}

	// ── verify_on_apply tests ─────────────────────────────────────────────────

	#[test]
	fn verify_non_spark_table_no_proof_allows() {
		// "profile" is not in the fallback identity-scoped table list → no binding required
		let resolver = make_resolver(None, None);
		let res = make_res("profile", Uuid::new_v4());
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				None,
				None
			),
			CapDecision::Allow
		);
	}

	#[test]
	fn verify_spark_table_no_proof_denies() {
		// "todos" IS in the fallback identity-scoped list → must carry an owner binding
		let resolver = make_resolver(None, None);
		let res = make_res("todos", Uuid::new_v4());
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				None,
				None
			),
			CapDecision::DenyPermanent
		);
	}

	#[test]
	fn verify_valid_owner_binding_by_identity_owner_allows() {
		let sk = SigningKey::from_bytes(&[1u8; 32]);
		let mut vault = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&vault, sid).unwrap();
		vault.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		let binding = mint_owner_binding(&sk, row, sid).unwrap();
		let proof = binding.to_meta_string();
		let es = aven_caps::ownership::sign_batch(&sk, &dummy_digest()).unwrap().to_meta_string();

		let resolver =
			make_resolver(Some(make_shell(vault)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				Some(es.as_bytes())
			),
			CapDecision::Allow
		);
	}

	#[test]
	fn verify_wrong_row_id_in_binding_denies() {
		let sk = SigningKey::from_bytes(&[1u8; 32]);
		let mut vault = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let other_row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&vault, sid).unwrap();
		vault.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		// Binding is minted for `other_row` but the ResourceCoord targets `row`.
		let binding = mint_owner_binding(&sk, other_row, sid).unwrap();
		let proof = binding.to_meta_string();

		let resolver =
			make_resolver(Some(make_shell(vault)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				None
			),
			CapDecision::DenyPermanent
		);
	}

	#[test]
	fn verify_forged_binding_signature_denies() {
		let sk = SigningKey::from_bytes(&[1u8; 32]);
		let mut vault = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&vault, sid).unwrap();
		vault.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		let mut binding = mint_owner_binding(&sk, row, sid).unwrap();
		binding.sig[0] ^= 0xff; // corrupt one byte of the 64-byte signature
		let proof = binding.to_meta_string();

		let resolver =
			make_resolver(Some(make_shell(vault)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				None
			),
			CapDecision::DenyPermanent
		);
	}

	#[test]
	fn verify_relabeling_row_to_different_owner_denies() {
		let sk_a = SigningKey::from_bytes(&[1u8; 32]);
		let mut vault = make_vault(&[1u8; 32]);
		let sid_a = Uuid::new_v4();
		let sid_b = Uuid::new_v4(); // attacker's target identity
		let row = Uuid::new_v4();
		let biscuit_a = mint_genesis_identity(&vault, sid_a).unwrap();
		vault.identities.insert(sid_a, BiscuitIdentity { owner: sid_a, biscuit: biscuit_a });

		// The ACL records sid_a as the established owner; binding claims sid_b.
		let binding = mint_owner_binding(&sk_a, row, sid_b).unwrap();
		let proof = binding.to_meta_string();

		let resolver =
			make_resolver(Some(make_shell(vault)), Some(acl_with_row("todos", row, sid_a)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				None
			),
			CapDecision::DenyPermanent,
			"relabeling an existing row to a different identity must be rejected"
		);
	}

	/// Explicit design assertion: a blind relay that does not hold the identity's
	/// biscuit accepts any authentically-signed owner binding (store-and-forward).
	/// This test documents the intentional design per the threat model — any future
	/// change that denies here is a breaking behaviour change and should be deliberate.
	#[test]
	fn verify_blind_relay_allows_authentic_binding() {
		let sk = SigningKey::from_bytes(&[1u8; 32]);
		// Relay vault holds NO identities.
		let relay_vault = make_vault(&[7u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let binding = mint_owner_binding(&sk, row, sid).unwrap();
		let proof = binding.to_meta_string();
		let es = aven_caps::ownership::sign_batch(&sk, &dummy_digest()).unwrap().to_meta_string();

		let resolver = make_resolver(Some(make_shell(relay_vault)), None);
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				Some(es.as_bytes())
			),
			CapDecision::Allow,
			"blind relay must allow any authentically-signed binding it doesn't hold the key for"
		);
	}

	#[test]
	fn verify_unauthorized_writer_denied_when_vault_holds_identity() {
		// Outsider is not in the identity's biscuit chain — they can mint a valid
		// signature (their key is real) but the biscuit deny catches the authorization gap.
		let sk_outsider = SigningKey::from_bytes(&[9u8; 32]);
		let mut vault = make_vault(&[1u8; 32]);
		let sid = Uuid::new_v4();
		let row = Uuid::new_v4();
		let biscuit = mint_genesis_identity(&vault, sid).unwrap();
		vault.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit });

		let binding = mint_owner_binding(&sk_outsider, row, sid).unwrap();
		let proof = binding.to_meta_string();
		let es = aven_caps::ownership::sign_batch(&sk_outsider, &dummy_digest()).unwrap().to_meta_string();

		let resolver =
			make_resolver(Some(make_shell(vault)), Some(acl_with_row("todos", row, sid)));
		let res = make_res("todos", row);
		assert_eq!(
			resolver.verify_on_apply(
				&dummy_subject(),
				AccOp::Write,
				&res,
				&dummy_digest(),
				Some(proof.as_bytes()),
				Some(es.as_bytes())
			),
			CapDecision::DenyPermanent,
			"outsider with a valid signature but no biscuit grant must be denied"
		);
	}
}
