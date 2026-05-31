//! Blind-relay data plane — shared by dominant outbound and subordinate inbound halves.
//!
//! # Central-relay connect contract
//!
//! Both peers use the same co-hosted coordinator (`relay_through` pk @ bootstrap UDP port):
//!
//! 1. **Discovery** — topic announce/lookup on the central HyperDHT bootstrap.
//! 2. **Noise IK** — `PEER_HANDSHAKE` via that bootstrap; both sides exchange the same
//!    deterministic `relay_through.token` (pair topic + relay pk).
//! 3. **Blind-relay pair** — subordinate registers `pair(true, token)` on the coordinator;
//!    dominant registers `pair(false, token)`. The coordinator wires UDX data streams.
//! 4. **SecretStream** — end-to-end encrypted peer link; coordinator only sees opaque bytes.
//!
//! ## Resilience rules (Hyperswarm-aligned)
//!
//! - **Patient pair wait** — [`BlindRelayClient::pair`] blocks until the coordinator responds
//!   or the control channel closes. No local timeout that sends `unpair` (that poisoned the
//!   counterpart's slot). Outer [`SERVER_RELAY_LINK_TIMEOUT`] / swarm connect caps bound hangs.
//! - **Per-side slot cleanup** — when one control session ends, [`BlindRelayCoordinator::drop_pair_half`]
//!   removes only that side's pending half so the counterpart can still match on retry.
//! - **Explicit `unpair` only** — reserved for deliberate cancel, not timeout side-effects.
//! - **Wired relay streams** — once matched, coordinator [`ActiveRelayLink`] keeps forwarding
//!   until the token is unpired; peer mux keepalive maintains the app link above SecretStream.

use libudx::UdxRuntime;

use super::blind_relay::BlindRelayClient;
use super::connect_ui::ConnectTransportMode;
use super::hyperdht::{next_stream_id, HyperDhtError, KeyPair, PeerConnection};
use super::noise_wrap::NoiseWrapResult;
use super::protomux::Mux;
use super::secret_stream::SecretStream;

/// Outer cap for subordinate inbound half (coordinator connect + patient pair + SecretStream).
/// Central relay happy path is a few seconds; this is the hung-connect ceiling only.
pub const SERVER_RELAY_LINK_TIMEOUT_SECS: u64 = 25;

/// Blind-relay protomux pair wait — documented for tests; pair itself has no inner deadline.
pub const PAIR_TIMEOUT_SECS: u64 = 10;

/// Connect + blind-relay pair — must cover patient pair + UDX/Noise slack.
pub const SERVER_RELAY_LINK_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(SERVER_RELAY_LINK_TIMEOUT_SECS);

/// Legacy alias — pair wait is bounded by [`SERVER_RELAY_LINK_TIMEOUT`], not a separate timer.
pub const PAIR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(PAIR_TIMEOUT_SECS);

/// Parameters for upgrading a relay control-channel UDX session into an encrypted peer link.
pub struct RelayLinkParams<'a> {
    /// Local Ed25519 keypair for the blind-relay Protomux channel.
    pub key_pair: &'a KeyPair,
    /// Pre-exchanged pair token from the Noise handshake `relay_through` field.
    pub token: &'a [u8; 32],
    /// Blind-relay pair role (`true` = subordinate inbound half, `false` = dominant outbound).
    pub pair_is_initiator: bool,
    /// Noise SecretStream role for the peer data plane.
    pub noise_is_initiator: bool,
    /// Completed Noise IK session keys for SecretStream.
    pub noise_result: &'a NoiseWrapResult,
    /// UDX control channel to the blind-relay host (post-handshake, pre-pair).
    pub relay_control: PeerConnection,
    /// Shared UDX runtime for opening the relayed data stream.
    pub runtime: &'a UdxRuntime,
}

/// Pair on the relay control mux and open the encrypted UDX data stream to the remote peer.
pub async fn establish(params: RelayLinkParams<'_>) -> Result<PeerConnection, HyperDhtError> {
    let RelayLinkParams {
        key_pair,
        token,
        pair_is_initiator,
        noise_is_initiator,
        noise_result,
        relay_control,
        runtime,
    } = params;

    let relay_addr = relay_control.remote_addr.ok_or_else(|| {
        HyperDhtError::StreamEstablishment("relay connection has no remote_addr".into())
    })?;

    let (mux, mux_run) = Mux::new(relay_control.stream);
    let mux_task = tokio::spawn(mux_run);

    let mut relay_client =
        BlindRelayClient::open(&mux, Some(key_pair.public_key.to_vec())).await?;
    relay_client.wait_opened().await?;
    tracing::info!(
        pair_is_initiator,
        token = %format_args!("{:02x?}", &token[..4]),
        "blind-relay: protomux channel open — pairing on coordinator",
    );

    let data_stream_id = next_stream_id();
    let pair_response = match relay_client
        .pair(pair_is_initiator, token, u64::from(data_stream_id))
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::info!(
                is_initiator = pair_is_initiator,
                token = %format_args!("{:02x?}", &token[..4]),
                err = %e,
                "blind-relay pair failed",
            );
            return Err(HyperDhtError::Relay(e));
        }
    };

    let remote_id = u32::try_from(pair_response.remote_id).map_err(|_| {
        HyperDhtError::StreamEstablishment("relay remote_id out of u32 range".into())
    })?;

    let data_stream = runtime.create_stream(data_stream_id).await?;
    data_stream
        .connect(&relay_control.socket, remote_id, relay_addr)
        .await?;

    let async_stream = data_stream.into_async_stream();
    let ss = SecretStream::from_session(
        noise_is_initiator,
        async_stream,
        noise_result.tx,
        noise_result.rx,
        noise_result.handshake_hash,
        noise_result.remote_public_key,
    )
    .await?;

    let mut conn = PeerConnection::with_remote_addr(
        ss,
        noise_result.remote_public_key,
        relay_addr,
        relay_control.socket,
        Some(mux_task),
    );
    conn.transport_mode = Some(ConnectTransportMode::Relay);
    Ok(conn)
}
