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

use groove::{AccOp, CapDecision, CapabilityResolver, ResourceCoord, SyncTargetId};

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
	/// accepted only if it carries an authentic **owner-binding** whose author is
	/// authorized for the identity. This runs on EVERY peer (incl. the always-on server),
	/// so a forged or relabeled row is rejected at apply — not merely withheld outbound.
	fn verify_on_apply(
		&self,
		_subject: &SyncTargetId,
		_op: AccOp,
		res: &ResourceCoord,
		_digest: &[u8; 32],
		proof: Option<&[u8]>,
	) -> CapDecision {
		// Private by default: a identity-scoped row MUST carry an owner-binding — **no table
		// exclusions**. Non-identity-scoped tables (local vault/shell, humans) aren't gated
		// here. Control-plane access control is the per-kind cap below (`peers`→`Admit`,
		// `keyshares`→`RotateDek`), not a skip.
		let Some(proof) = proof else {
			if crate::identity_sync::is_spark_scoped_table(&res.table) {
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

		// (b) Authorization — if we hold this identity's biscuit (we're a member), enforce
		//     that the author may actually write it. A blind relay that does not hold the
		//     identity accepts on authenticity alone; members do the membership check.
		let Ok(shell_guard) = self.shell.read() else {
			return CapDecision::Pending;
		};
		let Some(shell) = shell_guard.as_ref() else {
			return CapDecision::Pending;
		};
		if !shell.vault.identities.contains_key(&binding.owner) {
			return CapDecision::Allow;
		}
		// Per-kind cap: the author must hold the right that matches the row's kind.
		match crate::identity_acc::authorize(
			&shell.vault,
			binding.owner,
			required_write_op_for_table(&res.table),
			&res.table,
			Some(binding.value_id),
			&binding.author_did,
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
