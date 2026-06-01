//! Biscuit-backed peer-sync gate — the single authorizer (plan §1.2 / §6).
//!
//! `may_sync(subject, op, resource)` is the one question the engine asks before
//! shipping a batch to a peer. Here it is answered from spark biscuits:
//!   1. subject (`PeerId` = Ed25519 pubkey) → `did:key:`
//!   2. resource `(table, row)` → spark id (via the live `SyncAclSnapshot`)
//!   3. `spark_acc::authorize(vault, spark, op, table, row, peer_did)`
//!
//! Three-state per §1.2: `Pending` (ACL / vault not hydrated yet) DEFERS — it
//! never drops a frame; only an explicit biscuit denial is `DenyPermanent`.
//!
//! Read paths are `std::sync::RwLock` (not tokio) because `may_sync` is sync and
//! runs on the engine tick thread.

use std::sync::{Arc, RwLock};

use groove::{AccOp, CapDecision, CapabilityResolver, ResourceCoord, SyncTargetId};

use crate::jazz::jazz_engine::ShellState;
use crate::spark_sync::SyncAclSnapshot;

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

		// 2. Resource → spark. Missing map = not hydrated yet → DEFER (never drop).
		let Ok(acl_guard) = self.acl.read() else {
			return CapDecision::Pending;
		};
		let Some(acl) = acl_guard.as_ref() else {
			return CapDecision::Pending;
		};
		let Some(&spark_id) = acl.object_spark_ids.get(&(res.table.clone(), res.row_id)) else {
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
		let spark_op = match op {
			AccOp::Read => crate::spark_acc::AccOp::Read,
			AccOp::Write => crate::spark_acc::AccOp::Write,
			AccOp::Delete => crate::spark_acc::AccOp::Delete,
		};
		match crate::spark_acc::authorize(
			&shell.vault,
			spark_id,
			spark_op,
			&res.table,
			Some(*res.row_id.uuid()),
			&peer_did,
		) {
			Ok(()) => CapDecision::Allow,
			Err(_) => CapDecision::DenyPermanent,
		}
	}
}
