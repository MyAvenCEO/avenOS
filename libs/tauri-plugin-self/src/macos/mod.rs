#![cfg(any(target_os = "macos", target_os = "ios"))]

pub mod commands;

use std::ffi::{c_char, c_void, CStr};

use swift_rs::{SRData, SRObject, SRString};
use tokio::sync::oneshot;

#[allow(non_snake_case)]
#[repr(C)]
pub struct CreateKeyResultObject {
	pub blob: SRData,
	pub publicKey: SRData,
}

#[allow(non_snake_case)]
#[repr(C)]
pub struct DeriveSecretResultObject {
	pub secret: SRData,
}

enum SelfCallbackResult {
	Success(usize),
	Failure(String),
}

type SelfResultCallback =
	unsafe extern "C" fn(result: *mut c_void, error_message: *const c_char, context: u64);

extern "C" fn self_result_callback(
	result: *mut c_void,
	error_message: *const c_char,
	context: u64,
) {
	let sender: Box<oneshot::Sender<SelfCallbackResult>> =
		unsafe { Box::from_raw(context as *mut _) };
	if !result.is_null() {
		let _ = sender.send(SelfCallbackResult::Success(result as usize));
		return;
	}
	let msg = if error_message.is_null() {
		"self bridge: unknown error".to_string()
	} else {
		let s = unsafe { CStr::from_ptr(error_message) }
			.to_string_lossy()
			.into_owned();
		unsafe {
			libc::free(error_message as *mut _);
		}
		s
	};
	let _ = sender.send(SelfCallbackResult::Failure(msg));
}

extern "C" {
	fn self_create_se_key_bridge(context: u64, callback: SelfResultCallback);
	fn self_derive_root_secret_bridge(
		blob: SRData,
		peer_pub: SRData,
		reason: SRString,
		context: u64,
		callback: SelfResultCallback,
	);
	fn self_public_key_from_blob_bridge(blob: SRData) -> SRData;
}

unsafe fn sr_object_from_raw<T>(ptr: *mut c_void) -> SRObject<T> {
	std::mem::transmute(ptr)
}

/// Create a fresh SE-resident P-256 key. Returns `(opaque_se_blob, uncompressed_sec1_public_key)`.
/// No biometric prompt — key creation is silent; first use triggers the SE's ACL.
pub(crate) async fn create_se_key() -> Result<(Vec<u8>, Vec<u8>), String> {
	let (sender, receiver) = oneshot::channel::<SelfCallbackResult>();
	let context = Box::into_raw(Box::new(sender)) as u64;

	unsafe {
		self_create_se_key_bridge(context, self_result_callback);
	}

	match receiver.await {
		Ok(SelfCallbackResult::Success(raw)) => {
			let obj: SRObject<CreateKeyResultObject> =
				unsafe { sr_object_from_raw(raw as *mut c_void) };
			Ok((obj.blob.to_vec(), obj.publicKey.to_vec()))
		}
		Ok(SelfCallbackResult::Failure(msg)) => Err(msg),
		Err(_) => Err("self_create_se_key channel closed".to_string()),
	}
}

/// Asks the SE to perform ECDH against `peer_pub` after a **single** `LAContext` biometric prompt.
/// `reason` is the string shown in the Touch ID sheet.
pub(crate) async fn derive_root_secret(
	blob: &[u8],
	peer_pub: &[u8],
	reason: &str,
) -> Result<Vec<u8>, String> {
	let (sender, receiver) = oneshot::channel::<SelfCallbackResult>();
	let context = Box::into_raw(Box::new(sender)) as u64;

	unsafe {
		self_derive_root_secret_bridge(
			SRData::from(blob),
			SRData::from(peer_pub),
			SRString::from(reason),
			context,
			self_result_callback,
		);
	}

	match receiver.await {
		Ok(SelfCallbackResult::Success(raw)) => {
			let obj: SRObject<DeriveSecretResultObject> =
				unsafe { sr_object_from_raw(raw as *mut c_void) };
			let vec = obj.secret.to_vec();
			if vec.len() != 32 {
				return Err(format!(
					"se_ecdh_hkdf produced {} bytes, expected 32",
					vec.len()
				));
			}
			Ok(vec)
		}
		Ok(SelfCallbackResult::Failure(msg)) => Err(msg),
		Err(_) => Err("self_derive_root_secret channel closed".to_string()),
	}
}

/// Defensive: derive 65-byte SEC1 public point straight from the SE blob (no Touch ID).
/// Cache file is the normal source; this is only used to repair the cache if it's missing.
pub(crate) fn public_key_from_blob(blob: &[u8]) -> Result<Vec<u8>, String> {
	let sr = unsafe { self_public_key_from_blob_bridge(SRData::from(blob)) };
	let vec = sr.to_vec();
	if vec.len() < 65 {
		Err("public_key_from_blob: SE returned malformed point".into())
	} else {
		Ok(vec)
	}
}
