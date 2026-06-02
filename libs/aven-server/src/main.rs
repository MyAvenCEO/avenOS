//! aven-server — the unified always-on "aven" (plan §4).
//!
//! One binary, three roles under one did:key identity: device-admission (auth,
//! P2), the blind mirror + rendezvous + indexer (headless engine + server-mode
//! `HyperswarmTransport`, P3), all future-deployable to fly as one image.
//!
//! P0: skeleton only. P3 wires the three roles together.

fn main() {
    println!(
        "aven-server skeleton — P3 wires auth (aven-auth) + headless SyncManager \
         + server-mode HyperswarmTransport under one identity."
    );
}
