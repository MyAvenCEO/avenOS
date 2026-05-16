//! Process-lifetime cache for the SE-derived `device_root_secret`.
//!
//! Held in Rust **only**: never copied into the WebView's JS heap. The frontend asks for sign /
//! pubkey ops by name; this module performs them with the cached root and only the **public**
//! outputs cross the IPC boundary.

use std::sync::Mutex;
use zeroize::Zeroizing;

/// Tauri `manage()`d state. Default = locked.
#[derive(Default)]
pub struct SelfState {
	root: Mutex<Option<Zeroizing<[u8; 32]>>>,
}

impl SelfState {
	/// Stash a fresh 32-byte root secret. Replaces any previous one (zeroized on drop).
	pub fn set_root(&self, bytes: [u8; 32]) {
		*self.root.lock().expect("self-state poisoned") = Some(Zeroizing::new(bytes));
	}

	/// Drop the root secret. Idempotent.
	pub fn clear(&self) {
		*self.root.lock().expect("self-state poisoned") = None;
	}

	pub fn is_unlocked(&self) -> bool {
		self.root.lock().expect("self-state poisoned").is_some()
	}

	/// Run `f` against the cached root if present. Errors with `Err("locked")` otherwise.
	pub fn with_root<R>(&self, f: impl FnOnce(&[u8; 32]) -> Result<R, String>) -> Result<R, String> {
		let guard = self.root.lock().expect("self-state poisoned");
		match guard.as_ref() {
			Some(z) => f(&**z),
			None => Err("locked: call plugin:self|unlock first".to_string()),
		}
	}
}
