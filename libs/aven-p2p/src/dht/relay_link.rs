//! Blind-relay data plane — shared by dominant outbound and subordinate inbound halves.

use libudx::UdxRuntime;

use super::blind_relay::BlindRelayClient;
use super::connect_ui::ConnectTransportMode;
use super::hyperdht::{next_stream_id, HyperDhtError, KeyPair, PeerConnection};
use super::noise_wrap::NoiseWrapResult;
use super::protomux::Mux;
use super::secret_stream::SecretStream;

/// Blind-relay protomux pair wait on the coordinator control channel (seconds).
pub const PAIR_TIMEOUT_SECS: u64 = 20;

/// Connect + pair budget for subordinate inbound half (`PAIR_TIMEOUT_SECS` + UDX connect slack).
pub const SERVER_RELAY_LINK_TIMEOUT_SECS: u64 = PAIR_TIMEOUT_SECS + 15;

/// Blind-relay protomux pair wait on the coordinator control channel.
pub const PAIR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(PAIR_TIMEOUT_SECS);

/// Connect + blind-relay pair — must cover full [`PAIR_TIMEOUT`] on the relay mux.
pub const SERVER_RELAY_LINK_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(SERVER_RELAY_LINK_TIMEOUT_SECS);

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
        .pair_with_timeout(
            pair_is_initiator,
            token,
            u64::from(data_stream_id),
            PAIR_TIMEOUT,
        )
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
