//! Stronghold snapshot at `identities/<slug>/vault/strong.hold`.

use std::path::Path;
use std::sync::Mutex;

use hkdf::Hkdf;
use iota_stronghold::{ClientError, KeyProvider, SnapshotPath, Stronghold};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::network;
use crate::paths;

const STRONGHOLD_CLIENT: &str = "vault";
const SECRETS_STORE: &str = "secrets";

pub fn derive_stronghold_key(root: &[u8; 32]) -> Zeroizing<[u8; 32]> {
	let info = format!("{}/stronghold/v1", network::NETWORK_SEED);
	let hk = Hkdf::<Sha256>::new(None, root);
	let mut out = Zeroizing::new([0u8; 32]);
	hk.expand(info.as_bytes(), &mut out[..])
		.expect("stronghold hkdf expand");
	out
}

pub struct StrongholdSession {
	inner: Mutex<Option<StrongholdHandle>>,
}

struct StrongholdHandle {
	stronghold: Stronghold,
	path: std::path::PathBuf,
	snapshot_key: Zeroizing<[u8; 32]>,
	dirty: bool,
}

impl Default for StrongholdSession {
	fn default() -> Self {
		Self {
			inner: Mutex::new(None),
		}
	}
}

impl StrongholdSession {
	pub fn is_open(&self) -> bool {
		self.inner
			.lock()
			.ok()
			.is_some_and(|g| g.is_some())
	}

	pub fn open_or_create(&self, hold_path: &Path, root: &[u8; 32]) -> Result<(), String> {
		let snapshot_key = derive_stronghold_key(root);
		let mut guard = self.inner.lock().map_err(|_| "stronghold poisoned".to_string())?;
		if guard.is_some() {
			return Ok(());
		}
		let stronghold = if hold_path.is_file() {
			load_stronghold(hold_path, &snapshot_key)?
		} else {
			create_stronghold(hold_path, &snapshot_key)?
		};
		*guard = Some(StrongholdHandle {
			stronghold,
			path: hold_path.to_path_buf(),
			snapshot_key,
			dirty: false,
		});
		Ok(())
	}

	pub fn save_and_close(&self) -> Result<(), String> {
		let mut guard = self.inner.lock().map_err(|_| "stronghold poisoned".to_string())?;
		let Some(handle) = guard.take() else {
			return Ok(());
		};
		if handle.dirty {
			save_stronghold(&handle.stronghold, &handle.path, &handle.snapshot_key)?;
		}
		Ok(())
	}

	pub fn with_store<F, R>(&self, f: F) -> Result<R, String>
	where
		F: FnOnce(&mut Stronghold) -> Result<R, String>,
	{
		let mut guard = self.inner.lock().map_err(|_| "stronghold poisoned".to_string())?;
		let handle = guard.as_mut().ok_or("stronghold locked: unlock identity first")?;
		let out = f(&mut handle.stronghold)?;
		handle.dirty = true;
		Ok(out)
	}

	pub fn secrets_insert(&self, id: &str, value: &[u8]) -> Result<(), String> {
		self.with_store(|sh| insert_secret(sh, id, value))
	}

	pub fn secrets_get(&self, id: &str) -> Result<Vec<u8>, String> {
		self.with_store(|sh| get_secret(sh, id))
	}

	pub fn secrets_remove(&self, id: &str) -> Result<(), String> {
		self.with_store(|sh| remove_secret(sh, id))
	}

	pub fn secrets_list_ids(&self) -> Result<Vec<String>, String> {
		self.with_store(|sh| list_secret_ids(sh))
	}
}

fn key_provider(key: &[u8; 32]) -> Result<KeyProvider, String> {
	KeyProvider::try_from(Zeroizing::new(key.to_vec()))
		.map_err(|e| format!("stronghold key: {e:?}"))
}

fn load_stronghold(path: &Path, key: &[u8; 32]) -> Result<Stronghold, String> {
	let sh = Stronghold::default();
	let keyprovider = key_provider(key)?;
	let snapshot_path = SnapshotPath::from_path(path);
	sh.load_client_from_snapshot(STRONGHOLD_CLIENT, &keyprovider, &snapshot_path)
		.map_err(map_sh_err)?;
	Ok(sh)
}

fn create_stronghold(path: &Path, key: &[u8; 32]) -> Result<Stronghold, String> {
	if let Some(parent) = path.parent() {
		std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
	}
	let sh = Stronghold::default();
	sh.create_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	save_stronghold(&sh, path, key)?;
	load_stronghold(path, key)
}

fn save_stronghold(sh: &Stronghold, path: &Path, key: &[u8; 32]) -> Result<(), String> {
	let keyprovider = key_provider(key)?;
	let tmp = path.with_extension("hold.tmp");
	if let Some(parent) = tmp.parent() {
		std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
	}
	let snapshot_tmp = SnapshotPath::from_path(&tmp);
	sh.write_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	sh.commit_with_keyprovider(&snapshot_tmp, &keyprovider)
		.map_err(map_sh_err)?;
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
			.map_err(|e| format!("chmod {}: {e}", tmp.display()))?;
	}
	std::fs::rename(&tmp, path).map_err(|e| format!("rename strong.hold: {e}"))?;
	Ok(())
}

fn ensure_client(sh: &Stronghold) -> Result<(), String> {
	if sh.get_client(STRONGHOLD_CLIENT).is_err() {
		sh.create_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	}
	Ok(())
}

fn secret_store_key(id: &str) -> Result<Vec<u8>, String> {
	if id.is_empty() || id.contains('/') {
		return Err("invalid_secret_id".into());
	}
	Ok(format!("{SECRETS_STORE}/{id}").into_bytes())
}

fn insert_secret(sh: &mut Stronghold, id: &str, value: &[u8]) -> Result<(), String> {
	if id == "__index__" {
		ensure_client(sh)?;
		let client = sh.get_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
		let key = secret_store_key(id)?;
		client
			.store()
			.insert(key, value.to_vec(), None)
			.map_err(map_sh_err)?;
		return Ok(());
	}
	ensure_client(sh)?;
	let client = sh.get_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	let key = secret_store_key(id)?;
	client
		.store()
		.insert(key, value.to_vec(), None)
		.map_err(map_sh_err)?;
	let mut ids = list_secret_ids(sh)?;
	if !ids.iter().any(|x| x == id) {
		ids.push(id.to_string());
		ids.sort();
		update_secrets_index(sh, &ids)?;
	}
	Ok(())
}

fn list_secret_ids(sh: &mut Stronghold) -> Result<Vec<String>, String> {
	let index_key = "__index__";
	match get_secret_raw(sh, index_key) {
		Ok(raw) => serde_json::from_slice(&raw).map_err(|e| format!("secrets index parse: {e}")),
		Err(_) => Ok(Vec::new()),
	}
}

fn get_secret_raw(sh: &mut Stronghold, id: &str) -> Result<Vec<u8>, String> {
	ensure_client(sh)?;
	let client = sh.get_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	let key = secret_store_key(id)?;
	client
		.store()
		.get(&key)
		.map_err(map_sh_err)?
		.ok_or_else(|| format!("secret not found: {id}"))
}

fn get_secret(sh: &mut Stronghold, id: &str) -> Result<Vec<u8>, String> {
	get_secret_raw(sh, id)
}

fn remove_secret(sh: &mut Stronghold, id: &str) -> Result<(), String> {
	if id == "__index__" {
		return Err("cannot_remove_secrets_index".into());
	}
	ensure_client(sh)?;
	let client = sh.get_client(STRONGHOLD_CLIENT).map_err(map_sh_err)?;
	let key = secret_store_key(id)?;
	client.store().delete(&key).map_err(map_sh_err)?;
	let mut ids = list_secret_ids(sh)?;
	ids.retain(|x| x != id);
	update_secrets_index(sh, &ids)
}

pub fn update_secrets_index(sh: &mut Stronghold, ids: &[String]) -> Result<(), String> {
	let raw = serde_json::to_vec(ids).map_err(|e| format!("secrets index encode: {e}"))?;
	insert_secret(sh, "__index__", &raw)
}

pub fn stronghold_path_for_identity(identity_root: &Path) -> std::path::PathBuf {
	paths::stronghold_path(identity_root)
}

fn map_sh_err(e: ClientError) -> String {
	format!("stronghold: {e:?}")
}
