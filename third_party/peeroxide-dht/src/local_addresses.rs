//! Enumerate local IPv4 LAN addresses for Noise `addresses4` (Hyperswarm parity).
//!
//! Used so relayed peers can discover a shared subnet (e.g. iOS Personal Hotspot
//! `172.20.10.0/28`) and open UDX directly instead of carrier same-IP holepunch.

use std::net::Ipv4Addr;

use crate::messages::Ipv4Peer;

/// True if `ip` is on the Apple Personal Hotspot pseudo-LAN (`172.20.10.0/28`).
pub fn is_apple_tether_subnet(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 172 && o[1] == 20 && o[2] == 10 && o[3] < 16
}

fn is_lan_candidate(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return false;
    }
    ip.is_private() || is_apple_tether_subnet(ip)
}

/// Returns non-loopback LAN IPv4 addresses from the host (RFC1918 + Apple tether range).
pub fn enumerate_ipv4_lan() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = match if_addrs::get_if_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .filter_map(|ifa| match ifa.ip() {
                std::net::IpAddr::V4(ip) if is_lan_candidate(ip) => Some(ip),
                _ => None,
            })
            .collect(),
        Err(e) => {
            tracing::debug!(error = %e, "enumerate_ipv4_lan: if_addrs failed — empty addresses4");
            vec![]
        }
    };

    out.sort_by_key(|ip| ip.to_bits());
    out.dedup_by_key(|ip| ip.to_bits());
    out
}

/// Stable-sorted IPv4 LAN entries for Noise `addresses4` given explicit IPs (tests + helpers).
pub fn addresses4_sorted_from_ips(mut ips: Vec<Ipv4Addr>, port: u16) -> Vec<Ipv4Peer> {
    ips.retain(|ip| is_lan_candidate(*ip));
    ips.sort_by_key(|ip| ip.to_bits());
    ips.dedup_by_key(|ip| ip.to_bits());
    ips.into_iter()
        .map(|ip| Ipv4Peer {
            host: ip.to_string(),
            port,
        })
        .collect()
}

/// Local addresses for Noise `addresses4` with the Hyperswarm DHT UDP listening port.
pub fn build_addresses4(port: u16) -> Vec<Ipv4Peer> {
    enumerate_ipv4_lan()
        .into_iter()
        .map(|ip| Ipv4Peer {
            host: ip.to_string(),
            port,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apple_tether_range_edges() {
        assert!(is_apple_tether_subnet(Ipv4Addr::new(172, 20, 10, 0)));
        assert!(is_apple_tether_subnet(Ipv4Addr::new(172, 20, 10, 15)));
        assert!(!is_apple_tether_subnet(Ipv4Addr::new(172, 20, 10, 16)));
        assert!(!is_apple_tether_subnet(Ipv4Addr::new(172, 20, 9, 255)));
    }

    #[test]
    fn addresses4_sorted_filter_and_port() {
        let ips = vec![
            Ipv4Addr::new(192, 168, 1, 50),
            Ipv4Addr::new(127, 0, 0, 1),
            Ipv4Addr::new(10, 0, 0, 99),
            Ipv4Addr::new(172, 20, 10, 2),
            Ipv4Addr::new(8, 8, 8, 8),
        ];
        let peers = addresses4_sorted_from_ips(ips, 49737);
        assert_eq!(peers.len(), 3);
        assert!(peers.iter().all(|p| p.port == 49737));
        assert_eq!(peers[0].host, "10.0.0.99");
        assert_eq!(peers[1].host, "172.20.10.2");
        assert_eq!(peers[2].host, "192.168.1.50");
    }
}
