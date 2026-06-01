//! Human-scoped identity selection — `identities/<slug>/` under the AvenOS app base.
//!
//! # State machine (the source of truth)
//!
//! ```text
//!                  vault_select(slug)              unlock()  [pins ppK]
//!     Locked  ──────────────────────▶  Locked  ─────────────────────▶  Unlocked
//!     {None}      (pre-unlock pick)    {pending}                       {slug, ppk}
//!        ▲                                                                  │
//!        └────────────────────  lock()  ────────────────────────────────────┘
//! ```
//!
//! Invariants enforced by the type:
//! - `vault_select` is rejected while `Unlocked` — the only way to bind a different
//!   identity is `lock` first. Background tasks can never silently swap vaults.
//! - The slug stored under `Unlocked` is the *witness* of which vault directory
//!   backs the currently unlocked Ed25519 account public key (`ppK`). The ppK
//!   itself is derived from the SE-wrapped root secret inside that vault; the
//!   two are pinned together atomically inside [`ActiveVault::pin_unlocked`].
//! - `selected_slug()` and `require_slug()` prefer the pinned slug over any
//!   pre-unlock pending slug, so post-unlock callers can never accidentally
//!   read a stale pre-unlock pick.
//!
//! Process memory only; all state cleared by [`crate::commands::lock`].

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

use crate::paths;

/// Pinned identity binding `<identities/slug>` ↔ Ed25519 account public key (ppK).
/// Created only inside [`ActiveVault::pin_unlocked`], called from `unlock` after
/// the root secret has been derived from biometry.
#[derive(Clone)]
struct PinnedIdentity {
	slug: String,
	ppk: [u8; 32],
}

#[derive(Default)]
struct VaultBinding {
	/// Pre-unlock pick (lock screen). Cleared on `lock()` or promoted on `pin_unlocked`.
	pending_slug: Option<String>,
	/// Post-unlock pin. Once set, slug is immutable until `lock()`.
	pinned: Option<PinnedIdentity>,
}

#[derive(Default)]
pub struct ActiveVault {
	inner: Mutex<VaultBinding>,
}

impl ActiveVault {
	/// Active slug — pinned wins over pending. Always returns the slug whose
	/// vault directory backs the currently unlocked identity when `Unlocked`.
	pub fn selected_slug(&self) -> Result<Option<String>, String> {
		let g = self.inner.lock().map_err(|_| "active_vault_poisoned")?;
		Ok(g.pinned
			.as_ref()
			.map(|p| p.slug.clone())
			.or_else(|| g.pending_slug.clone()))
	}

	/// Reset to the `Locked{None}` start state. Called by `lock()`.
	pub fn clear(&self) -> Result<(), String> {
		let mut g = self.inner.lock().map_err(|_| "active_vault_poisoned")?;
		g.pending_slug = None;
		g.pinned = None;
		Ok(())
	}

	/// Pre-unlock pick. **Rejected while `Unlocked`** — must `lock` first.
	/// This is the choke point that prevents background cross-pollination between vaults.
	pub fn select(&self, slug: impl Into<String>) -> Result<(), String> {
		let s = slug.into();
		paths::validate_username_slug(&s)?;
		let mut g = self.inner.lock().map_err(|_| "active_vault_poisoned")?;
		if let Some(p) = g.pinned.as_ref() {
			if p.slug == s {
				// Idempotent: selecting the same already-unlocked slug is a no-op.
				return Ok(());
			}
			return Err(
				"vault_already_unlocked: lock first before selecting a different identity"
					.to_string(),
			);
		}
		g.pending_slug = Some(s);
		Ok(())
	}

	/// Resolves the active slug or errors with a friendly hint.
	pub fn require_slug(&self) -> Result<String, String> {
		self.selected_slug()?.ok_or_else(|| {
			"no_active_vault: pick or create an identity vault first".to_string()
		})
	}

	/// Promote `Locked → Unlocked`, pinning the slug to the derived Ed25519 ppK.
	/// Called from inside `unlock` immediately after `SelfState::set_root`.
	///
	/// Idempotent for the same (slug, ppk) pair (re-unlock of the same identity).
	/// Errors if a *different* identity is already pinned — callers must `lock` first.
	pub fn pin_unlocked(&self, slug: impl Into<String>, ppk: [u8; 32]) -> Result<(), String> {
		let s = slug.into();
		paths::validate_username_slug(&s)?;
		let mut g = self.inner.lock().map_err(|_| "active_vault_poisoned")?;
		if let Some(existing) = g.pinned.as_ref() {
			if existing.slug == s && existing.ppk == ppk {
				g.pending_slug = None;
				return Ok(());
			}
			return Err(
				"vault_already_unlocked: cannot pin a different identity (lock first)".to_string(),
			);
		}
		g.pinned = Some(PinnedIdentity { slug: s, ppk });
		g.pending_slug = None;
		Ok(())
	}

	/// Returns the pinned Ed25519 account public key (ppK), if currently unlocked.
	pub fn pinned_ppk(&self) -> Result<Option<[u8; 32]>, String> {
		let g = self.inner.lock().map_err(|_| "active_vault_poisoned")?;
		Ok(g.pinned.as_ref().map(|p| p.ppk))
	}

	/// True iff an identity is pinned (i.e. the binding is `Unlocked`).
	pub fn is_unlocked(&self) -> bool {
		self.inner
			.lock()
			.map(|g| g.pinned.is_some())
			.unwrap_or(false)
	}
}

/// On-disk profile for onboarding copy (readable before Jazz/Groove).
pub const VAULT_MANIFEST_FILENAME: &str = crate::paths::MANIFEST_FILENAME;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultManifest {
	pub first_name: String,
	pub username_slug: String,
	pub device_label: String,
	pub created_at_ms: i64,
}

impl VaultManifest {
	pub fn pairing_display(&self) -> String {
		format!(
			"{}/{}",
			self.first_name.trim(),
			self.device_label.trim(),
		)
	}
}

pub fn pairing_label_from_manifest_path(vault_root: &std::path::Path) -> Option<String> {
	let p = crate::paths::manifest_path(vault_root);
	let raw = std::fs::read_to_string(&p).ok()?;
	let m: VaultManifest = serde_json::from_str(&raw).ok()?;
	let s = m.pairing_display();
	if s.trim().is_empty() || s.ends_with('/') {
		return None;
	}
	Some(s)
}

pub fn pairing_label_for_app<R: Runtime>(
	app: &AppHandle<R>,
	vault: &ActiveVault,
) -> Option<String> {
	crate::paths::aven_os_user_root(app, vault).ok().and_then(|p| pairing_label_from_manifest_path(&p))
}

#[cfg(test)]
mod state_machine_tests {
	use super::*;

	fn ppk(n: u8) -> [u8; 32] {
		[n; 32]
	}

	#[test]
	fn select_then_pin_unlocked_pins_slug_to_ppk() {
		let v = ActiveVault::default();
		v.select("samuel").expect("select pre-unlock ok");
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("samuel"));
		assert!(!v.is_unlocked());

		v.pin_unlocked("samuel", ppk(1)).expect("pin ok");
		assert!(v.is_unlocked());
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("samuel"));
		assert_eq!(v.pinned_ppk().unwrap(), Some(ppk(1)));
	}

	#[test]
	fn vault_select_is_rejected_while_unlocked() {
		// The whole point of the binding: once an identity is pinned, no IPC,
		// no background task, can swap to a different vault without `lock` first.
		let v = ActiveVault::default();
		v.select("samuel").unwrap();
		v.pin_unlocked("samuel", ppk(1)).unwrap();

		let err = v
			.select("maia")
			.expect_err("must reject select-to-different-slug while unlocked");
		assert!(
			err.contains("vault_already_unlocked"),
			"error must name the invariant; got: {err}"
		);
		// Stale pick must not stick around either.
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("samuel"));
		assert_eq!(v.pinned_ppk().unwrap(), Some(ppk(1)));
	}

	#[test]
	fn reselecting_same_slug_while_unlocked_is_idempotent_noop() {
		let v = ActiveVault::default();
		v.select("samuel").unwrap();
		v.pin_unlocked("samuel", ppk(1)).unwrap();
		v.select("samuel").expect("idempotent same-slug select ok");
		assert_eq!(v.pinned_ppk().unwrap(), Some(ppk(1)));
	}

	#[test]
	fn pin_unlocked_rejects_changing_identity_after_pin() {
		// Defence-in-depth: even an internal caller can't swap ppK without `lock` first.
		let v = ActiveVault::default();
		v.select("samuel").unwrap();
		v.pin_unlocked("samuel", ppk(1)).unwrap();

		let err = v
			.pin_unlocked("maia", ppk(2))
			.expect_err("cannot re-pin different identity");
		assert!(err.contains("vault_already_unlocked"));
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("samuel"));
		assert_eq!(v.pinned_ppk().unwrap(), Some(ppk(1)));
	}

	#[test]
	fn lock_clears_both_pending_and_pinned() {
		let v = ActiveVault::default();
		v.select("samuel").unwrap();
		v.pin_unlocked("samuel", ppk(1)).unwrap();
		v.clear().unwrap();
		assert!(!v.is_unlocked());
		assert_eq!(v.selected_slug().unwrap(), None);
		assert_eq!(v.pinned_ppk().unwrap(), None);

		// After lock, a fresh pick is allowed again.
		v.select("maia").unwrap();
		v.pin_unlocked("maia", ppk(2)).unwrap();
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("maia"));
		assert_eq!(v.pinned_ppk().unwrap(), Some(ppk(2)));
	}

	#[test]
	fn selected_slug_prefers_pinned_over_pending() {
		// Pending only ever exists pre-unlock. Once pinned, the witness slug
		// is the source of truth — never look at a stale pending pick.
		let v = ActiveVault::default();
		v.select("samuel").unwrap();
		v.pin_unlocked("samuel", ppk(1)).unwrap();
		// Internal poke: drop pending so we only have pinned. (already true after pin)
		assert_eq!(v.selected_slug().unwrap().as_deref(), Some("samuel"));
	}
}
