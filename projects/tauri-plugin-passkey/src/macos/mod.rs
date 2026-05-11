#![cfg(target_os = "macos")]

pub mod commands;

use std::ffi::{c_char, c_void, CStr};
use swift_rs::{SRObject, SRData, SRString};
use tokio::sync::oneshot;

// --- FFI bindings ---
extern "C" {
	pub fn begin_passkey_registration(
		window_ptr: *mut c_void,
		domain: SRString,
		challenge: SRData,
		username: SRString,
		user_id: SRData,
		salt: SRData,
		context: u64,
		callback: PasskeyResultCallback,
	);

	pub fn begin_passkey_login(
		window_ptr: *mut c_void,
		domain: SRString,
		challenge: SRData,
		salt: SRData,
		context: u64,
		callback: PasskeyResultCallback,
	);
}

// --- Result structs exposed to frontend ---
#[derive(Debug, serde::Serialize)]
pub struct PasskeyRegistrationResult {
	pub id: String,
	pub raw_id: String,
	pub client_data_json: String,
	pub attestation_object: String,
	pub prf_output: Vec<u8>,
}

#[derive(Debug, serde::Serialize)]
pub struct PasskeyLoginResult {
	pub id: String,
	pub raw_id: String,
	pub client_data_json: String,
	pub authenticator_data: String,
	pub signature: String,
	pub user_handle: String,
	pub prf_output: Vec<u8>,
}

// --- FFI structs used to match Swift NSObject layout ---
#[allow(non_snake_case)]
#[repr(C)]
pub struct RegistrationResultObject {
	pub id: SRString,
	pub rawId: SRString,
	pub clientDataJSON: SRString,
	pub attestationObject: SRString,
	pub prfOutput: SRData,
}

#[allow(non_snake_case)]
#[repr(C)]
pub struct LoginResultObject {
	pub id: SRString,
	pub rawId: SRString,
	pub clientDataJSON: SRString,
	pub authenticatorData: SRString,
	pub signature: SRString,
	pub userHandle: SRString,
	pub prfOutput: SRData,
}

enum PasskeyCallbackResult {
	Success(usize),
	Failure(String),
}

type PasskeyResultCallback =
	unsafe extern "C" fn(result: *mut c_void, error_message: *const c_char, context: u64);

extern "C" fn passkey_result_callback(result: *mut c_void, error_message: *const c_char, context: u64) {
	let sender: Box<oneshot::Sender<PasskeyCallbackResult>> =
		unsafe { Box::from_raw(context as *mut _) };
	if !result.is_null() {
		let _ = sender.send(PasskeyCallbackResult::Success(result as usize));
		return;
	}
	let msg = if error_message.is_null() {
		"Passkey operation failed".to_string()
	} else {
		let s = unsafe { CStr::from_ptr(error_message) }
			.to_string_lossy()
			.into_owned();
		unsafe {
			libc::free(error_message as *mut _);
		}
		s
	};
	let _ = sender.send(PasskeyCallbackResult::Failure(msg));
}

/// Async wrapper for passkey registration.
/// Takes `window_raw` as `usize` (a `Send`-safe representation of the NSWindow pointer)
/// so the returned future is `Send` as required by Tauri command handlers.
pub async fn begin_registration_from_rust(
	window_raw: usize,
	domain: &str,
	challenge: &[u8],
	username: &str,
	user_id: &[u8],
	salt: &[u8],
) -> Result<PasskeyRegistrationResult, String> {
	let (sender, receiver) = oneshot::channel::<PasskeyCallbackResult>();
	let context = Box::into_raw(Box::new(sender)) as u64;

	unsafe {
		begin_passkey_registration(
			window_raw as *mut c_void,
			SRString::from(domain),
			SRData::from(challenge),
			SRString::from(username),
			SRData::from(user_id),
			SRData::from(salt),
			context,
			passkey_result_callback,
		);
	}

	match receiver.await {
		Ok(PasskeyCallbackResult::Success(raw)) => {
			let obj: SRObject<RegistrationResultObject> = unsafe { sr_object_from_raw(raw as *mut c_void) };

			Ok(PasskeyRegistrationResult {
				id: obj.id.to_string(),
				raw_id: obj.rawId.to_string(),
				client_data_json: obj.clientDataJSON.to_string(),
				attestation_object: obj.attestationObject.to_string(),
				prf_output: obj.prfOutput.to_vec(),
			})
		}
		Ok(PasskeyCallbackResult::Failure(msg)) => Err(msg),
		Err(_) => Err("Passkey registration channel closed".to_string()),
	}
}

pub async fn begin_login_from_rust(
	window_raw: usize,
	domain: &str,
	challenge: &[u8],
	salt: &[u8],
) -> Result<PasskeyLoginResult, String> {
	let (sender, receiver) = oneshot::channel::<PasskeyCallbackResult>();
	let context = Box::into_raw(Box::new(sender)) as u64;

	unsafe {
		begin_passkey_login(
			window_raw as *mut c_void,
			SRString::from(domain),
			SRData::from(challenge),
			SRData::from(salt),
			context,
			passkey_result_callback,
		);
	}

	match receiver.await {
		Ok(PasskeyCallbackResult::Success(raw)) => {
			let obj: SRObject<LoginResultObject> = unsafe { sr_object_from_raw(raw as *mut c_void) };

			Ok(PasskeyLoginResult {
				id: obj.id.to_string(),
				raw_id: obj.rawId.to_string(),
				client_data_json: obj.clientDataJSON.to_string(),
				authenticator_data: obj.authenticatorData.to_string(),
				signature: obj.signature.to_string(),
				user_handle: obj.userHandle.to_string(),
				prf_output: obj.prfOutput.to_vec(),
			})
		}
		Ok(PasskeyCallbackResult::Failure(msg)) => Err(msg),
		Err(_) => Err("Passkey login channel closed".to_string()),
	}
}

pub unsafe fn sr_object_from_raw<T>(ptr: *mut c_void) -> SRObject<T> {
	std::mem::transmute(ptr)
}
