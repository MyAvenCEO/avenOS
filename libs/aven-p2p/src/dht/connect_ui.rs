//! Optional UI hooks for outbound connect progress and established transport mode.

use std::sync::Arc;

/// In-flight connect sub-phase (shown while parent UI state is “connecting”).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectProgressPhase {
	/// DHT lookup on pair topic.
	Discovering,
	/// Noise IK (+ optional DHT relay for handshake).
	Handshaking,
	/// Blind-relay pair on coordinator control mux.
	RelayPairing,
}

/// Established UDX data-path (relay-only product).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectTransportMode {
	/// Blind-relay coordinator pair.
	Relay,
}

/// Connect UI lifecycle event keyed by remote static public key.
#[derive(Debug, Clone)]
pub enum ConnectUiEvent {
	/// Progress update during outbound connect.
	Progress {
		/// Remote peer Ed25519 public key.
		remote_pk: [u8; 32],
		/// Current in-flight phase.
		phase: ConnectProgressPhase,
	},
	/// UDX stream established.
	Connected {
		/// Remote peer Ed25519 public key.
		remote_pk: [u8; 32],
		/// Established transport mode.
		mode: ConnectTransportMode,
	},
	/// Connect attempt failed or link dropped.
	Disconnected {
		/// Remote peer Ed25519 public key.
		remote_pk: [u8; 32],
	},
}

/// Optional callback installed by host apps for per-peer connect UI.
pub type ConnectUiHook = Arc<dyn Fn(ConnectUiEvent) + Send + Sync>;
