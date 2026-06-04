//! Probe the real `WsClientTransport` handshake against a live `/sync` endpoint.
//!
//!   cargo run --example ws_probe --manifest-path libs/aven-p2p/Cargo.toml -- \
//!     wss://aven-ceo-bmrha.sprites.app/sync
//!
//! Exercises the full nonce-bound did:key handshake (ServerHello → ClientAuth →
//! AuthResult) over the public Sprite URL — the exact path a device takes.

use aven_p2p::WsClientTransport;
use ed25519_dalek::SigningKey;

#[tokio::main]
async fn main() {
    let url = std::env::args().nth(1).expect("usage: ws_probe <ws-url>");
    let key = SigningKey::from_bytes(&[42u8; 32]);
    let did =
        groove::did_key::peer_did_from_ed25519(&key.verifying_key().to_bytes()).unwrap();
    eprintln!("dialing {url} as {did}");
    match WsClientTransport::connect(&url, key).await {
        Ok(t) => {
            let server = t.server_peer_id();
            let server_did =
                groove::did_key::peer_did_from_ed25519(&server.0).unwrap_or_default();
            println!("OK authenticated — server_did={server_did}");
        }
        Err(e) => {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        }
    }
}
