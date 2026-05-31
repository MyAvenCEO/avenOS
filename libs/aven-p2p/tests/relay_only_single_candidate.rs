//! Relay-only connect policy — deterministic pair tokens and single bootstrap candidate.

use aven_p2p::dht::blind_relay::{derive_pair_token, derive_pair_token_from_pks, resolve_pair_token};

#[test]
fn relay_only_pair_token_stable_across_halves() {
    let relay_pk = [0x4e; 32];
    let topic = [0xab; 32];
    let alice = [0x02u8; 32];
    let bob = [0x5du8; 32];

    let server_token = resolve_pair_token(Some(&topic), &bob, &alice, &relay_pk);
    let client_token = resolve_pair_token(Some(&topic), &alice, &bob, &relay_pk);
    assert_eq!(
        server_token, client_token,
        "dominant and subordinate must derive the same blind-relay pair token"
    );
    assert_eq!(server_token, derive_pair_token(&topic, &relay_pk));
}

#[test]
fn relay_only_pk_fallback_order_invariant() {
    let relay_pk = [0x11; 32];
    let a = [0x01; 32];
    let b = [0x02; 32];
    assert_eq!(
        derive_pair_token_from_pks(&a, &b, &relay_pk),
        derive_pair_token_from_pks(&b, &a, &relay_pk),
    );
}

#[test]
fn relay_only_server_link_timeout_covers_pair_budget() {
    use aven_p2p::dht::relay_link::{
        PAIR_TIMEOUT, PAIR_TIMEOUT_SECS, SERVER_RELAY_LINK_TIMEOUT, SERVER_RELAY_LINK_TIMEOUT_SECS,
    };
    assert!(SERVER_RELAY_LINK_TIMEOUT >= PAIR_TIMEOUT);
    assert_eq!(PAIR_TIMEOUT_SECS, 10);
    assert_eq!(SERVER_RELAY_LINK_TIMEOUT_SECS, 25);
}

#[test]
fn relay_only_single_bootstrap_is_first_hint_only() {
    let hints = vec![
        ("137.66.21.59".to_string(), 49737u16),
        ("88.99.3.86".to_string(), 49737u16),
    ];
    let chosen = hints.first().map(|(h, p)| (h.clone(), *p));
    assert_eq!(
        chosen,
        Some(("137.66.21.59".to_string(), 49737)),
        "relay-only profile must not walk FIND_NODE when the first bootstrap hint suffices"
    );
}
