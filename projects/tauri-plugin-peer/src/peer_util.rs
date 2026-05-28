//! Shared helpers for the peer plugin (time, coarse mesh signals).

#![cfg(any(target_os = "macos", target_os = "ios"))]

pub fn now_ms() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.map(|d| d.as_millis() as u64)
		.unwrap_or(0)
}
