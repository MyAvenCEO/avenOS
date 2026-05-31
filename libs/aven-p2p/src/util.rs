//! Shared helpers for swarm and DHT layers.

use std::fmt::Write;

/// First four bytes of a public key as lowercase hex (logging).
pub fn short_hex(bytes: &[u8]) -> String {
    bytes.iter().take(4).fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// `127.0.0.0/8`, `0.0.0.0`, and IPv6 loopback never round-trip between machines.
pub fn is_unroutable_relay_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_unspecified() || ip.is_link_local();
    }
    if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
        return ip.is_loopback() || ip.is_unspecified();
    }
    false
}
