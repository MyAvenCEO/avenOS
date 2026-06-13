//! Connection admission against the **avenCEO roster** — the relay's access-control SSOT.
//!
//! The relay owns avenCEO, so it can read avenCEO's network roster in cleartext: every
//! `signers` row owned by avenCEO carries a plaintext `signer_did` (the member device's
//! did:key) and `owner == avenceo_id`. A connecting peer proves that *same* did:key form in
//! the handshake (`PeerId` → `signer_did_from_ed25519`), so classification is a direct
//! set-membership test — no user DEK, no biscuit decryption, no DID-layer translation.
//!
//! **Enforcement (this build):** a peer NOT in the roster is denied **outbound** reads of
//! the spark *data* content tables (todos/messages/files/…), so a non-member cannot pull
//! members' content; the trust/identity/control tables (safes/keyshares/signers/…) stay
//! open so a new device can still onboard. Members get full sync.
//!
//! **Known limit (documented, not hidden):** the roster is built from avenCEO-owned
//! `signers` rows, which the blind relay cannot fully *authorize* (membership flows through
//! a human-SAFE chain sealed under the human's DEK), so it is **trust-on-publish**. The
//! sound, poison-proof control is a handshake membership-proof (the device presents its own
//! SAFE chain at connect) — a both-ends protocol change tracked in board 0023. Until then,
//! treat this as a dev-grade enforced default, not the production public-lockout.

use std::collections::HashSet;

use aven_db::{AvenDbClient, QueryBuilder, TableName, Value};
use uuid::Uuid;

/// What standing the relay assigns a freshly-authenticated peer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeerTier {
    /// The peer's device did:key is in avenCEO's roster → full sync.
    Member,
    /// Not (yet) in the roster → restricted onboarding (may push only self-authored rows,
    /// pull only avenCEO genesis + keyshares addressed to it). A new device is here until
    /// its signer is published into / granted on avenCEO, after which it classifies Member.
    Onboarding,
}

/// avenCEO's network roster as the blind relay can read it: the set of member **device**
/// did:keys (`signers.signer_did` where `owner == avenceo_id`, status active).
#[derive(Clone, Debug, Default)]
pub struct Roster {
    pub member_signer_dids: HashSet<String>,
}

impl Roster {
    /// True if this exact device did:key is a published avenCEO member.
    pub fn contains(&self, signer_did: &str) -> bool {
        self.member_signer_dids.contains(signer_did.trim())
    }
}

/// Pure classification — the one decision, unit-testable without an engine. A peer whose
/// device did:key is in the roster is a `Member`; everyone else is `Onboarding` (never
/// rejected here — the did:key proof already gated *authenticity* upstream).
pub fn classify_peer(peer_signer_did: &str, roster: &Roster) -> PeerTier {
    if roster.contains(peer_signer_did) {
        PeerTier::Member
    } else {
        PeerTier::Onboarding
    }
}

/// Pure outbound decision: may a peer of `tier` receive a row on `table`? Members get
/// everything; an onboarding (non-member) peer is denied the spark **data** content tables
/// (`spark_data`) so it cannot pull members' content, but is still served the
/// trust/identity/control tables it needs to onboard. Unit-testable without an engine.
pub fn outbound_allowed(tier: PeerTier, table: &str, spark_data: &HashSet<String>) -> bool {
    match tier {
        PeerTier::Member => true,
        PeerTier::Onboarding => !spark_data.contains(table),
    }
}

fn col_ix(schema: &aven_db::Schema, table: &str, name: &str) -> Option<usize> {
    schema
        .get(&TableName::new(table))?
        .columns
        .columns
        .iter()
        .position(|c| c.name_str() == name)
}

fn text_at(vals: &[Value], ix: usize) -> String {
    match vals.get(ix) {
        Some(Value::Text(s)) => s.clone(),
        _ => String::new(),
    }
}

fn uuid_matches(vals: &[Value], ix: usize, want: Uuid) -> bool {
    match vals.get(ix) {
        Some(Value::Uuid(o)) => *o.uuid() == want,
        Some(Value::Text(s)) => Uuid::parse_str(s.trim()).map(|u| u == want).unwrap_or(false),
        _ => false,
    }
}

/// Read avenCEO's member roster from the durable store: device did:keys published as
/// avenCEO signers (`signers.owner == avenceo_id`, `status == "active"` when present). All
/// columns read here are plaintext routing columns the blind relay can see without any DEK.
pub async fn read_avenceo_member_signer_dids(
    engine: &AvenDbClient,
    avenceo_id: Uuid,
) -> Result<HashSet<String>, String> {
    let schema = engine.schema().await.map_err(|e| format!("schema:{e:?}"))?;
    let Some(owner_ix) = col_ix(&schema, "signers", "owner") else {
        return Ok(HashSet::new()); // no signers table / column → empty roster
    };
    let signer_ix = col_ix(&schema, "signers", "signer_did");
    let status_ix = col_ix(&schema, "signers", "status");
    let q = QueryBuilder::new(TableName::new("signers")).build();
    let rows = engine.query(q, None).await.map_err(|e| format!("query:{e:?}"))?;
    let mut out = HashSet::new();
    for (_oid, vals) in rows {
        if !uuid_matches(&vals, owner_ix, avenceo_id) {
            continue;
        }
        // If a status column exists, only count active signers; tolerate its absence.
        if let Some(si) = status_ix {
            let st = text_at(&vals, si);
            if !st.is_empty() && st != "active" {
                continue;
            }
        }
        let Some(di) = signer_ix else { continue };
        let did = text_at(&vals, di);
        if !did.trim().is_empty() {
            out.insert(did.trim().to_string());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster(dids: &[&str]) -> Roster {
        Roster { member_signer_dids: dids.iter().map(|d| d.to_string()).collect() }
    }

    #[test]
    fn member_did_classifies_full() {
        let r = roster(&["did:key:zMEMBER", "did:key:zSERVER"]);
        assert_eq!(classify_peer("did:key:zMEMBER", &r), PeerTier::Member);
    }

    #[test]
    fn unknown_did_classifies_onboarding() {
        let r = roster(&["did:key:zMEMBER"]);
        assert_eq!(classify_peer("did:key:zSTRANGER", &r), PeerTier::Onboarding);
    }

    #[test]
    fn empty_roster_is_all_onboarding() {
        let r = Roster::default();
        assert_eq!(classify_peer("did:key:zANY", &r), PeerTier::Onboarding);
    }

    #[test]
    fn membership_ignores_surrounding_whitespace() {
        let r = roster(&["did:key:zMEMBER"]);
        assert_eq!(classify_peer("  did:key:zMEMBER  ", &r), PeerTier::Member);
    }

    fn spark_data() -> HashSet<String> {
        ["todos", "messages", "files"].iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn member_may_pull_everything() {
        let sd = spark_data();
        assert!(outbound_allowed(PeerTier::Member, "todos", &sd));
        assert!(outbound_allowed(PeerTier::Member, "safes", &sd));
    }

    #[test]
    fn onboarding_denied_content_allowed_trust_tables() {
        let sd = spark_data();
        // Denied the spark data/content tables…
        assert!(!outbound_allowed(PeerTier::Onboarding, "todos", &sd));
        assert!(!outbound_allowed(PeerTier::Onboarding, "messages", &sd));
        // …but still served the trust/identity/control tables it needs to onboard.
        assert!(outbound_allowed(PeerTier::Onboarding, "safes", &sd));
        assert!(outbound_allowed(PeerTier::Onboarding, "keyshares", &sd));
        assert!(outbound_allowed(PeerTier::Onboarding, "signers", &sd));
    }
}
