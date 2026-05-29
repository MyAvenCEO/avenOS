//! Pairing session FSM — blocks Recover heal while invite transport is in flight.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use crate::heal_intent::HealIntent;

const PAIR_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingPhase {
	Idle,
	Advertising,
	Joining,
	TransportUp,
	Persisting,
	Done,
}

#[derive(Debug, Clone)]
pub struct PairSession {
	pub topic: [u8; 32],
	pub code: String,
	pub my_advertised_label: String,
}

#[derive(Debug, Clone)]
pub struct PairingState {
	pub phase: PairingPhase,
	pub session: Option<PairSession>,
}

impl Default for PairingState {
	fn default() -> Self {
		Self {
			phase: PairingPhase::Idle,
			session: None,
		}
	}
}

impl PairingState {
	pub fn is_active(&self) -> bool {
		self.session.is_some() && !matches!(self.phase, PairingPhase::Done)
	}

	pub fn code_pending(&self) -> Option<String> {
		self.session.as_ref().map(|s| s.code.clone())
	}

	pub fn topic(&self) -> Option<[u8; 32]> {
		self.session.as_ref().map(|s| s.topic)
	}

	pub fn accepts_heal_intent(&self, intent: HealIntent) -> bool {
		match intent {
			HealIntent::Rendezvous | HealIntent::Reset => true,
			HealIntent::Recover => matches!(
				self.phase,
				PairingPhase::Idle | PairingPhase::Done
			),
		}
	}

	pub fn start_advertising(&mut self, session: PairSession) {
		self.session = Some(session);
		self.phase = PairingPhase::Advertising;
	}

	pub fn start_joining(&mut self, session: PairSession) {
		self.session = Some(session);
		self.phase = PairingPhase::Joining;
	}

	pub fn mark_transport_up(&mut self) {
		if self.session.is_some() {
			self.phase = PairingPhase::TransportUp;
		}
	}

	pub fn mark_persisting(&mut self) {
		if self.session.is_some() {
			self.phase = PairingPhase::Persisting;
		}
	}

	pub fn clear(&mut self) {
		self.session = None;
		self.phase = PairingPhase::Idle;
	}
}

pub fn pair_topic_hash(normalized_code: &str) -> [u8; 32] {
	let mut buf = Vec::with_capacity(b"aven:pair:v1:".len() + normalized_code.len());
	buf.extend_from_slice(b"aven:pair:v1:");
	buf.extend_from_slice(normalized_code.as_bytes());
	peeroxide::discovery_key(&buf)
}

pub fn pair_topic_from_dids(local_did: &str, remote_did: &str) -> [u8; 32] {
	let (a, b) = if local_did <= remote_did {
		(local_did, remote_did)
	} else {
		(remote_did, local_did)
	};
	let mut buf = Vec::with_capacity(64 + a.len() + b.len());
	buf.extend_from_slice(b"aven:peer-pair:v1:");
	buf.extend_from_slice(a.as_bytes());
	buf.push(0);
	buf.extend_from_slice(b.as_bytes());
	peeroxide::discovery_key(&buf)
}

pub fn generate_pair_code() -> String {
	use rand::Rng;
	let mut rng = rand::thread_rng();
	(0..6)
		.map(|_| PAIR_CODE_ALPHABET[rng.gen_range(0..PAIR_CODE_ALPHABET.len())] as char)
		.collect()
}

pub fn normalize_pair_code(raw: &str) -> Result<String, String> {
	let s: String = raw
		.chars()
		.filter(|c| !c.is_whitespace())
		.collect::<String>()
		.to_uppercase();
	if s.len() != 6 {
		return Err(format!("pair code must be 6 characters, got {}", s.len()));
	}
	if !s.chars().all(|c| PAIR_CODE_ALPHABET.contains(&(c as u8))) {
		return Err("pair code uses invalid characters".into());
	}
	Ok(s)
}

pub fn pairing_join_opts() -> peeroxide::JoinOpts {
	peeroxide::JoinOpts::fast_refresh()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn recover_blocked_during_joining() {
		let mut state = PairingState::default();
		state.start_joining(PairSession {
			topic: [0u8; 32],
			code: "ABCDEF".into(),
			my_advertised_label: "test".into(),
		});
		assert!(!state.accepts_heal_intent(HealIntent::Recover));
		assert!(state.accepts_heal_intent(HealIntent::Rendezvous));
	}

	#[test]
	fn recover_allowed_when_idle() {
		let state = PairingState::default();
		assert!(state.accepts_heal_intent(HealIntent::Recover));
	}
}
