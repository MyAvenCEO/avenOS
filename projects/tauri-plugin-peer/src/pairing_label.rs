//! One-frame label exchange on new pairing connections so each side learns the remote display name.

#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::time::Duration;

use peeroxide_dht::secret_stream::{SecretStream, SecretStreamError};
use tokio::time::timeout;

const PAIR_LABEL_MAGIC: &[u8] = b"avenos/pair-label/v1\0";
const PAIR_LABEL_MAX: usize = 512;
const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(5);

pub fn short_did_fallback(did: &str) -> String {
	let t = did.trim();
	if t.len() <= 28 {
		return t.to_string();
	}
	format!("{}…{}", &t[..16], &t[t.len().saturating_sub(8)..])
}

fn build_pair_label_frame(label: &str) -> Result<Vec<u8>, String> {
	let label = label.trim();
	if label.is_empty() {
		return Err("empty pairing label".into());
	}
	let bytes = label.as_bytes();
	if bytes.len() > PAIR_LABEL_MAX {
		return Err("pairing label too long".into());
	}
	let mut v = Vec::with_capacity(PAIR_LABEL_MAGIC.len() + bytes.len());
	v.extend_from_slice(PAIR_LABEL_MAGIC);
	v.extend_from_slice(bytes);
	Ok(v)
}

fn parse_pair_label_frame(data: &[u8]) -> Option<String> {
	if !data.starts_with(PAIR_LABEL_MAGIC) {
		return None;
	}
	let label = std::str::from_utf8(&data[PAIR_LABEL_MAGIC.len()..]).ok()?;
	let trimmed = label.trim();
	if trimmed.is_empty() {
		return None;
	}
	Some(trimmed.to_string())
}

async fn read_pair_label_frame<S>(stream: &mut SecretStream<S>) -> Result<String, String>
where
	S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send,
{
	match stream.read().await {
		Ok(Some(data)) => {
			parse_pair_label_frame(data.as_slice()).ok_or_else(|| "pair label: bad frame".into())
		}
		Ok(None) => Err("pair label: stream closed".into()),
		Err(e) => Err(format!("pair label read: {e:?}")),
	}
}

/// Initiator sends first; responder reads then sends (avoids write deadlock).
pub async fn exchange_pairing_label<S>(
	stream: &mut SecretStream<S>,
	my_label: &str,
	is_initiator: bool,
) -> Result<String, String>
where
	S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send,
{
	let outbound = build_pair_label_frame(my_label)?;

	let exchange = async {
		if is_initiator {
			stream
				.write(&outbound)
				.await
				.map_err(|e: SecretStreamError| format!("pair label write: {e:?}"))?;
			read_pair_label_frame(stream).await
		} else {
			let remote = read_pair_label_frame(stream).await?;
			stream
				.write(&outbound)
				.await
				.map_err(|e: SecretStreamError| format!("pair label write: {e:?}"))?;
			Ok(remote)
		}
	};

	timeout(EXCHANGE_TIMEOUT, exchange)
		.await
		.map_err(|_| "pair label exchange timed out".to_string())?
}
