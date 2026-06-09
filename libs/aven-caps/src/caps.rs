//! Offline capability gates (biscuit) for identity-scoped IPC.

use std::collections::HashSet;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use biscuit_auth::{
	builder::{Algorithm, AuthorizerBuilder, BlockBuilder},
	Biscuit, KeyPair, PublicKey,
};
use ed25519_dalek::SigningKey;
use uuid::Uuid;

#[derive(Clone)]
pub struct BiscuitIdentity {
	#[allow(dead_code)]
	pub owner: Uuid,
	pub biscuit: Biscuit,
}

pub struct BiscuitVault {
	pub biscuit_kp: KeyPair,
	pub peer_did: String,
	pub ed25519_public: [u8; 32],
	pub identities: std::collections::HashMap<Uuid, BiscuitIdentity>,
}

#[derive(Clone, Copy)]
pub enum AccOp {
	Read,
	Write,
	Delete,
	/// Blind store-and-forward (server avens added as replication peers). Holds a
	/// `right("replicate", …)` grant but no keyshare → carries ciphertext, cannot
	/// decrypt. Authorized without `trusted_admin` (a replica is not an admin).
	Replicate,
	/// Admit/modify a roster member — the `admit` right. Required to write a `peers`
	/// (roster) row, so membership changes are cap-gated like any other write rather
	/// than excluded from verification.
	Admit,
	/// Create or rotate a DEK keyshare — the `rotate_dek` right. Required to write a
	/// `keyshares` row, so key distribution is cap-gated uniformly.
	RotateDek,
}

impl AccOp {
	fn as_op_str(self) -> &'static str {
		match self {
			AccOp::Read => "read",
			AccOp::Write => "write",
			AccOp::Delete => "delete",
			AccOp::Replicate => "replicate",
			AccOp::Admit => "admit",
			AccOp::RotateDek => "rotate_dek",
		}
	}
}

fn identity_urn_for(owner: Uuid) -> String {
	format!("identity:{owner}")
}

/// **Default** display name of an aven's control identity. Each aven names its
/// default identity after **itself** (`AVEN_SERVER_NAME` on the aven-node, e.g.
/// `avenCEO` / `avenMAIA`); the aven-node's minted row is authoritative. This
/// constant is only the fallback/placeholder used by the first-admin client claim.
pub const AVEN_CEO_IDENTITY_NAME: &str = "avenCEO";

/// Deterministic id of the well-known network control identity (**`avenCEO`**, the
/// roster/membership identity), derived from the network seed. Every device in a
/// network computes the **same** id, so the identity can be shown by default and
/// **claimed** before anyone has synced: the first device to mint its genesis
/// becomes the owner (claim-once). Per-network (the seed scopes it), so distinct
/// networks don't collide on one id. Uses SHA-256 (the `uuid` crate's `v5` feature
/// isn't enabled) — stable across builds for a given seed.
pub fn aven_ceo_identity(network_seed: &str) -> Uuid {
	use sha2::{Digest, Sha256};
	let mut h = Sha256::new();
	h.update(b"avenos:avenCEO:v1:");
	h.update(network_seed.trim().as_bytes());
	let digest = h.finalize();
	let mut bytes = [0u8; 16];
	bytes.copy_from_slice(&digest[..16]);
	Uuid::from_bytes(bytes)
}

/// Deterministic id of a **sub-group** of `parent` (the group-owned-values model, M9).
/// Every value can be owned by its own group; a group's id is derived from its parent +
/// a stable `label`, so all peers compute the SAME id with no coordination. The **default**
/// group of an identity is the identity id itself — so existing `owner = identity_id` rows
/// need no migration — while finer groups (e.g. the registry) get a derived sub-id that
/// **extends** the parent. Same SHA-256 domain-separated scheme as [`aven_ceo_identity`].
pub fn derive_subgroup_id(parent: Uuid, label: &str) -> Uuid {
	use sha2::{Digest, Sha256};
	let mut h = Sha256::new();
	h.update(b"avenos:group:v1:");
	h.update(parent.as_bytes());
	h.update(b":");
	h.update(label.trim().as_bytes());
	let digest = h.finalize();
	let mut bytes = [0u8; 16];
	bytes.copy_from_slice(&digest[..16]);
	Uuid::from_bytes(bytes)
}

/// The **registry group** of an aven's control identity (M9-2): the sub-group that owns the
/// member directory (`identities` + `peers` rows). A SYNC peer is keyshared THIS group's DEK
/// (to read the directory) but never the control identity's main DEK — so it is
/// **cryptographically** blind to any data the control identity owns, not merely
/// authorization-filtered. `= derive_subgroup_id(aven_ceo_identity(seed), "registry")`.
pub fn aven_ceo_registry_group(network_seed: &str) -> Uuid {
	derive_subgroup_id(aven_ceo_identity(network_seed), "registry")
}

/// The rights a identity **owner** holds, minted into the genesis biscuit. THE single
/// source of truth for the rights vocabulary: [`mint_genesis_identity`] grants exactly
/// these, and [`identity_cap_report`] reports exactly these for an owner, so genesis
/// and the UI cap display can never drift.
pub const OWNER_RIGHTS: &[&str] = &["read", "write", "delete", "admit", "rotate_dek"];

/// Effective caps for a grant kind (`owns`/`reads`/`replicate`). Single mapping
/// from "how a subject is attached" → "what it may do". Owner = all OWNER_RIGHTS;
/// reader = read; replica = blind replicate (store-and-forward, no read).
pub fn grant_kind_caps(grant: &str) -> Vec<&'static str> {
	match grant {
		"owns" => OWNER_RIGHTS.to_vec(),
		"reads" => vec!["read"],
		"replicate" => vec!["replicate"],
		_ => vec![],
	}
}

/// One subject's effective caps on a identity, derived purely from the biscuit chain.
pub struct SubjectCaps {
	pub did: String,
	/// `owns` | `reads` | `replicate` | `member` (a subject with only granular grants)
	pub grant: String,
	pub caps: Vec<String>,
}

/// THE single source of truth for "who holds what cap on this identity": read the
/// biscuit chain (`owns`/`reads`/`replicate` + granular `grant(did,op,prefix)`)
/// and report each subject's role + effective caps, MERGED per DID. Owner role
/// takes precedence; granular ops (e.g. a member's row-scoped `write`) fold into
/// that subject's cap set so they surface in the UI. Sorted by DID.
pub fn identity_cap_report(chain: &Biscuit, owner: Uuid) -> Result<Vec<SubjectCaps>, String> {
	use std::collections::BTreeMap;
	let owners = identity_admins(chain, owner)?;
	let owner_set: HashSet<String> = owners.iter().map(|d| d.trim().to_string()).collect();
	// did → (role, ordered unique caps)
	let mut acc: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();
	fn add(acc: &mut BTreeMap<String, (String, Vec<String>)>, did: &str, role: &str, cap: &str) {
		let e = acc.entry(did.to_string()).or_insert_with(|| (role.to_string(), Vec::new()));
		// Role precedence: owns > reads > replicate > member.
		let rank = |r: &str| match r { "owns" => 3, "reads" => 2, "replicate" => 1, _ => 0 };
		if rank(role) > rank(&e.0) {
			e.0 = role.to_string();
		}
		if !cap.is_empty() && !e.1.iter().any(|x| x == cap) {
			e.1.push(cap.to_string());
		}
	}

	for did in &owners {
		for c in OWNER_RIGHTS {
			add(&mut acc, did, "owns", c);
		}
	}
	for did in identity_readers(chain, owner)? {
		if owner_set.contains(did.trim()) {
			continue;
		}
		add(&mut acc, &did, "reads", "read");
	}
	for did in identity_replicas(chain, owner)? {
		if owner_set.contains(did.trim()) {
			continue;
		}
		// A blind relay's effective caps = `replicate` (the biscuit grant) + the bounds
		// that grant implies on the aven that holds it: a per-identity 10 MB storage
		// `quota` + inbound `rate_limit`. We report them HERE (the single biscuit-reading
		// cap source the UI consumes) so they are NOT synthesized client-side and the
		// displayed caps can never drift from the grant. The node still ENFORCES the
		// resource bounds (it owns its storage); the report makes them transparent.
		add(&mut acc, &did, "replicate", "replicate");
		add(&mut acc, &did, "replicate", "quota");
		add(&mut acc, &did, "replicate", "rate_limit");
	}
	// Granular grants (row/table-scoped) — fold the op into the subject's caps.
	for (did, op, prefix) in identity_grants(chain, owner)? {
		if owner_set.contains(did.trim()) {
			continue;
		}
		// Honesty: a read SCOPED to the registry tables (`identities:` / `peers:`) is the
		// SYNC peer's directory access — it reads the member directory, NOT the identity's
		// data. Report it as the distinct cap `directory` so the badge can never imply broad
		// read access (a full-identity read is still reported as `read`).
		let cap: &str = if op == "read"
			&& (prefix.ends_with(":identities:") || prefix.ends_with(":peers:"))
		{
			"directory"
		} else {
			op.as_str()
		};
		add(&mut acc, &did, "member", cap);
	}

	Ok(acc
		.into_iter()
		.map(|(did, (grant, caps))| SubjectCaps { did, grant, caps })
		.collect())
}

pub fn biscuit_keypair_from_ed25519_signing(secret32: &[u8; 32]) -> Result<KeyPair, String> {
	KeyPair::from_bytes(secret32, Algorithm::Ed25519.into()).map_err(|e| format!("biscuit-kp-from-bytes:{e:?}"))
}

pub fn encode_issuer_pubkey_b64(pubkey: &PublicKey) -> String {
	URL_SAFE_NO_PAD.encode(pubkey.to_bytes())
}

/// Decode verifier root pubkey stored in [`identities.issuer_pubkey_b64`].
pub fn decode_issuer_pubkey_b64(b64: &str) -> Result<PublicKey, String> {
	let trimmed = b64.trim();
	if trimmed.is_empty() {
		return Err("issuer_pubkey_b64_empty".into());
	}
	let raw = URL_SAFE_NO_PAD
		.decode(trimmed.as_bytes())
		.map_err(|e| format!("issuer_pubkey_b64_decode:{e}"))?;
	PublicKey::from_bytes(raw.as_slice(), Algorithm::Ed25519.into()).map_err(|e| format!("issuer_pubkey_bad:{e:?}"))
}

/// Build a capability vault from an Ed25519 signing key. The caller derives the
/// key for its context (the device app from its root via tauri; the server from
/// `AVEN_SERVER_SEED`), keeping this crate free of any device/tauri specifics.
pub fn build_vault_from_signing_key(sk_ed: &SigningKey) -> Result<BiscuitVault, String> {
	let pk_arr = sk_ed.verifying_key().to_bytes();

	let biscuit_kp =
		biscuit_keypair_from_ed25519_signing(sk_ed.as_bytes())?;

	let peer_did =
		groove::did_key::peer_did_from_ed25519(&pk_arr)?;

	Ok(BiscuitVault {
		biscuit_kp,
		peer_did,
		ed25519_public: pk_arr,
		identities: std::collections::HashMap::new(),
	})
}

pub fn mint_genesis_identity(
	vault: &BiscuitVault,
	owner: Uuid,
) -> Result<Biscuit, String> {
	let identity_urn = identity_urn_for(owner);
	let prefix_lit = format!("{identity_urn}:");
	let own_f = format!(
			"owns(\"{}\", \"{}\")",
			vault.peer_did.replace('"', "\\\""),
			identity_urn.replace('"', "\\\"")
		);
	let mut bb = Biscuit::builder().fact(own_f.as_str()).map_err(|e| format!("genesis-own-fact:{e}"))?;

	for op in OWNER_RIGHTS {
		let rf = format!(
				"right(\"{op}\", \"{}\")",
				prefix_lit.replace('"', "\\\"")
			);
		bb = bb
			.fact(rf.as_str())
			.map_err(|e| format!("genesis-right:{e}"))?;
	}

	bb.build(&vault.biscuit_kp)
		.map_err(|e| format!("genesis-build:{e}"))
}

/// Mint a **sub-group** genesis biscuit (M9 group-owned values). Like
/// [`mint_genesis_identity`] — the creating vault is the group's `owns` admin with full
/// [`OWNER_RIGHTS`] over the group's resource prefix — but it also records
/// `extends("identity:<parent>")`. That fact makes the group **inherit** the parent
/// group's members: the live authorizer, on a local deny, consults the parent chain, so a
/// member of the parent is a member here with no per-group re-grant (cheap fine
/// granularity). Granularity is purely the `group_id` you pass — identity-level (the
/// identity itself), collection-level (`derive_subgroup_id(id, "todos")`), or row-level
/// (`derive_subgroup_id(id, row_id)`). The data model is identical at every level.
pub fn mint_group_genesis_extending(
	vault: &BiscuitVault,
	group_id: Uuid,
	parent_id: Uuid,
) -> Result<Biscuit, String> {
	let group_urn = identity_urn_for(group_id);
	let prefix_lit = format!("{group_urn}:");
	let parent_urn = identity_urn_for(parent_id);
	let own_f = format!(
		"owns(\"{}\", \"{}\")",
		vault.peer_did.replace('"', "\\\""),
		group_urn.replace('"', "\\\"")
	);
	let mut bb = Biscuit::builder()
		.fact(own_f.as_str())
		.map_err(|e| format!("group-own-fact:{e}"))?;
	for op in OWNER_RIGHTS {
		let rf = format!("right(\"{op}\", \"{}\")", prefix_lit.replace('"', "\\\""));
		bb = bb.fact(rf.as_str()).map_err(|e| format!("group-right:{e}"))?;
	}
	// Inheritance link: the live authorizer, on a deny, consults `parent`'s chain.
	let ext_f = format!("extends(\"{}\")", parent_urn.replace('"', "\\\""));
	bb = bb.fact(ext_f.as_str()).map_err(|e| format!("group-extends:{e}"))?;
	bb.build(&vault.biscuit_kp).map_err(|e| format!("group-build:{e}"))
}

/// The parent group this group `extends`, if any (M9 inheritance). `None` = a root group
/// (e.g. an identity's default group). Read straight from the genesis chain.
pub fn group_extends_parent(chain: &Biscuit) -> Result<Option<Uuid>, String> {
	let mut authorizer = chain.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rows: Vec<(String,)> = authorizer
		.query_all("parent($u) <- extends($u)")
		.map_err(|e| format!("b-query-extends:{e}"))?;
	for (urn,) in rows {
		if let Some(rest) = urn.strip_prefix("identity:") {
			if let Ok(u) = Uuid::parse_str(rest.trim()) {
				return Ok(Some(u));
			}
		}
	}
	Ok(None)
}

/// Append a third-party biscuit block granting `new_peer_did` an [`owns`] fact on this Identity,
/// signed by `delegating_kp` (typically the device's biscuit [`KeyPair`], i.e. same key that
/// anchored the genesis or a prior delegated admin's key — see biscuit third-party semantics).
pub fn attenuate_add_owner_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	owner: Uuid,
	new_peer_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let identity_str = identity_urn_for(owner);
	let own_f = format!(
		"owns(\"{}\", \"{}\")",
		new_peer_did.replace('\\', "\\\\").replace('"', "\\\""),
		identity_str.replace('\\', "\\\\").replace('"', "\\\"")
	);
	let bb = BlockBuilder::new()
		.fact(own_f.as_str())
		.map_err(|e| format!("tp_fact:{e}"))?;
	let block = req
		.create_block(&delegating_kp.private(), bb)
		.map_err(|e| format!("tp_create:{e:?}"))?;
	chain
		.append_third_party(delegating_kp.public(), block)
		.map_err(|e| format!("tp_append:{e:?}"))
}

/// Append a third-party block granting `replica_did` a [`replicate`] right over
/// this Identity's resource prefix, signed by `delegating_kp` (an admin's biscuit
/// key). Unlike [`attenuate_add_owner_third_party`] this grants **no `owns`** and
/// implies **no keyshare** — the holder may store & forward the identity's encrypted
/// batches (blind relay / backup) but is not a member and cannot decrypt.
pub fn attenuate_add_replicate_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	owner: Uuid,
	replica_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let prefix = format!("{}:", identity_urn_for(owner));
	let rep_f = format!(
		"replicate(\"{}\", \"{}\")",
		replica_did.replace('\\', "\\\\").replace('"', "\\\""),
		prefix.replace('\\', "\\\\").replace('"', "\\\"")
	);
	let bb = BlockBuilder::new()
		.fact(rep_f.as_str())
		.map_err(|e| format!("tp_rep_fact:{e}"))?;
	let block = req
		.create_block(&delegating_kp.private(), bb)
		.map_err(|e| format!("tp_rep_create:{e:?}"))?;
	chain
		.append_third_party(delegating_kp.public(), block)
		.map_err(|e| format!("tp_rep_append:{e:?}"))
}

/// Append a third-party block granting `reader_did` a [`reads`] right over this
/// Identity's resource prefix, signed by `delegating_kp` (an admin's biscuit key).
/// Grants **no `owns`** — the reader is a member who may decrypt (pair this with
/// a keyshare) but is **not** an admin and cannot write. This is the
/// "membership credential" an onboarded peer holds on `admin-identity`: it lets the
/// peer read the roster and marks it admitted (the server enumerates readers via
/// [`identity_readers`] to gate admission).
pub fn attenuate_add_reader_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	owner: Uuid,
	reader_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let prefix = format!("{}:", identity_urn_for(owner));
	let read_f = format!(
		"reads(\"{}\", \"{}\")",
		reader_did.replace('\\', "\\\\").replace('"', "\\\""),
		prefix.replace('\\', "\\\\").replace('"', "\\\"")
	);
	let bb = BlockBuilder::new()
		.fact(read_f.as_str())
		.map_err(|e| format!("tp_read_fact:{e}"))?;
	let block = req
		.create_block(&delegating_kp.private(), bb)
		.map_err(|e| format!("tp_read_create:{e:?}"))?;
	chain
		.append_third_party(delegating_kp.public(), block)
		.map_err(|e| format!("tp_read_append:{e:?}"))
}

/// All delegated-reader DIDs granted on a identity per the biscuit chain (members
/// who hold a `reads` grant but are not owners). The server reads this on
/// `admin-identity` to build its admission allowlist.
pub fn identity_readers(chain: &Biscuit, owner: Uuid) -> Result<HashSet<String>, String> {
	let prefix = format!("{}:", identity_urn_for(owner));
	let mut authorizer = chain.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rule = format!(
		r#"readers($p) <- reads($p, "{prefix}")"#,
		prefix = prefix.replace('"', "\\\"")
	);
	let rows: Vec<(String,)> = authorizer
		.query_all(rule.as_str())
		.map_err(|e| format!("b-query-reads:{e}"))?;
	Ok(rows.into_iter().map(|x| x.0).collect())
}

/// All replication-peer DIDs granted on a identity per the biscuit chain.
pub fn identity_replicas(chain: &Biscuit, owner: Uuid) -> Result<HashSet<String>, String> {
	let prefix = format!("{}:", identity_urn_for(owner));
	let mut authorizer = chain.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rule = format!(
		r#"replicas($p) <- replicate($p, "{prefix}")"#,
		prefix = prefix.replace('"', "\\\"")
	);
	let rows: Vec<(String,)> = authorizer
		.query_all(rule.as_str())
		.map_err(|e| format!("b-query-replicate:{e}"))?;
	Ok(rows.into_iter().map(|x| x.0).collect())
}

/// Re-mint a identity biscuit granting every current admin EXCEPT `exclude_did`
/// (v2 revoke). Genesis re-grants the owner (`vault.peer_did`); every other
/// remaining admin is re-appended. The excluded DID is simply not re-granted, so
/// the new chain's `owns` set no longer contains it → `authorize` denies it.
/// Pair with DEK rotation so the revoked peer also cannot decrypt new data.
///
/// NOTE: must be called by the genesis owner — `mint_genesis_identity` re-roots the
/// chain to `vault.biscuit_kp`, so a delegated (non-owner) admin cannot rebuild.
pub fn rebuild_identity_biscuit_excluding(
	vault: &BiscuitVault,
	owner: Uuid,
	exclude_did: &str,
) -> Result<Biscuit, String> {
	let chain = &vault
		.identities
		.get(&owner)
		.ok_or_else(|| format!("unknown_identity:{owner}"))?
		.biscuit;
	// Snapshot EVERY grant the current chain carries so revoke drops ONLY the excluded
	// DID. The prior version re-appended admins alone, so revoking any one peer silently
	// stripped EVERY reader (Member), replica (Sync), and row-scoped grant from the
	// identity — collateral access loss for everyone but the owner + admins.
	let admins = identity_admins(chain, owner)?;
	let readers = identity_readers(chain, owner)?;
	let replicas = identity_replicas(chain, owner)?;
	let grants = identity_grants(chain, owner)?;

	let kp = &vault.biscuit_kp;
	let excluded = |d: &str| peer_did_matches(d, exclude_did);
	let is_owner = |d: &str| peer_did_matches(d, &vault.peer_did);
	let mut biscuit = mint_genesis_identity(vault, owner)?;

	// Genesis already grants the owner; re-append every OTHER admin except the revoked
	// one. Sort each set for deterministic chain order (HashSet iteration is unstable).
	let mut admin_dids: Vec<String> =
		admins.into_iter().filter(|d| !excluded(d) && !is_owner(d)).collect();
	admin_dids.sort();
	for did in &admin_dids {
		biscuit = attenuate_add_owner_third_party(kp, &biscuit, owner, did)?;
	}
	// Delegated readers (Member). Skip any DID already re-granted the strictly-greater
	// owns above, and the owner/excluded DID.
	let already_owner = |d: &str| admin_dids.iter().any(|a| peer_did_matches(a, d));
	let mut reader_dids: Vec<String> = readers
		.into_iter()
		.filter(|d| !excluded(d) && !is_owner(d) && !already_owner(d))
		.collect();
	reader_dids.sort();
	for did in &reader_dids {
		biscuit = attenuate_add_reader_third_party(kp, &biscuit, owner, did)?;
	}
	// Blind replication peers (Sync relays).
	let mut replica_dids: Vec<String> = replicas.into_iter().filter(|d| !excluded(d)).collect();
	replica_dids.sort();
	for did in &replica_dids {
		biscuit = attenuate_add_replicate_third_party(kp, &biscuit, owner, did)?;
	}
	// Row/table-scoped granular grants (e.g. the avenCEO member's row-scoped `write`).
	let mut grant_rows: Vec<(String, String, String)> =
		grants.into_iter().filter(|(d, _, _)| !excluded(d)).collect();
	grant_rows.sort();
	for (did, op, prefix) in &grant_rows {
		biscuit = attenuate_add_grant_third_party(kp, &biscuit, did, op, prefix)?;
	}
	Ok(biscuit)
}

/// Ingest a identity biscuit after optional DEK unwrap (hydrate / migration paths).
pub fn ingest_genesis_opened(
	vault: &mut BiscuitVault,
	owner: Uuid,
	genesis_b64: &str,
	issuer_pubkey_b64: Option<&str>,
	local_fallback_issuer_pk: PublicKey,
) -> Result<(), String> {
	let issuer_pk = match issuer_pubkey_b64 {
		Some(s) if !s.trim().is_empty() => decode_issuer_pubkey_b64(s)?,
		_ => local_fallback_issuer_pk,
	};
	let biscuit = biscuit_from_storage(genesis_b64, issuer_pk)?;
	vault.identities.insert(
		owner,
		BiscuitIdentity {
			owner,
			biscuit,
		},
	);
	Ok(())
}

fn peer_did_matches(a: &str, b: &str) -> bool {
	a.trim() == b.trim()
}

pub fn identity_peer_is_owner(chain: &Biscuit, owner: Uuid, peer_did: &str) -> Result<bool, String> {
	let identity_str = identity_urn_for(owner);
	let admins = trusted_subject_dids(chain, &identity_str)?;
	Ok(admins.iter().any(|a| peer_did_matches(a, peer_did)))
}

/// All admin (`owns`) DIDs for a identity per the biscuit chain.
pub fn identity_admins(chain: &Biscuit, owner: Uuid) -> Result<std::collections::HashSet<String>, String> {
	let identity_str = identity_urn_for(owner);
	trusted_subject_dids(chain, &identity_str)
}

pub fn biscuit_from_storage(genesis_b64: &str, root: PublicKey) -> Result<Biscuit, String> {
	let raw = URL_SAFE_NO_PAD
		.decode(genesis_b64.as_bytes())
		.map_err(|e| format!("genesis-base64:{e}"))?;

	Biscuit::from(raw.as_slice(), root).map_err(|e| format!("biscuit-from:{e:?}"))
}

fn trusted_subject_dids(b: &Biscuit, identity_urn: &str) -> Result<HashSet<String>, String> {
	let mut authorizer =
		b.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rule = format!(r#"peers($p) <- owns($p, "{identity}")"#, identity = identity_urn);
	let admins: Vec<(String,)> = authorizer
		.query_all(rule.as_str())
		.map_err(|e| format!("b-query-own:{e}"))?;
	Ok(admins.into_iter().map(|x| x.0).collect())
}

/// Maximum group-extension chain depth (cycle / runaway guard).
const MAX_GROUP_DEPTH: u32 = 8;

/// Authorize `subject_did` for `op` on `owner`'s `table[:row]`. **M9 group inheritance:**
/// if the owner group's biscuit denies AND the group `extends(parent)`, a member of the
/// parent inherits the SAME authority here — re-checked against the parent group, bounded
/// by [`MAX_GROUP_DEPTH`]. A root group (no `extends` fact) behaves exactly as before, so
/// every existing identity is unaffected.
pub fn authorize(
	vault: &BiscuitVault,
	owner: Uuid,
	op: AccOp,
	table: &str,
	row_id: Option<Uuid>,
	subject_did: &str,
) -> Result<(), String> {
	authorize_with_depth(vault, owner, op, table, row_id, subject_did, 0)
}

fn authorize_with_depth(
	vault: &BiscuitVault,
	owner: Uuid,
	op: AccOp,
	table: &str,
	row_id: Option<Uuid>,
	subject_did: &str,
	depth: u32,
) -> Result<(), String> {
	match authorize_local(vault, owner, op, table, row_id, subject_did) {
		Ok(()) => Ok(()),
		Err(e) => {
			// Inheritance: a member of the parent group is a member here too.
			if depth < MAX_GROUP_DEPTH {
				if let Some(chain) = vault.identities.get(&owner) {
					if let Ok(Some(parent)) = group_extends_parent(&chain.biscuit) {
						if authorize_with_depth(vault, parent, op, table, row_id, subject_did, depth + 1)
							.is_ok()
						{
							return Ok(());
						}
					}
				}
			}
			Err(e)
		}
	}
}

fn authorize_local(
	vault: &BiscuitVault,
	owner: Uuid,
	op: AccOp,
	table: &str,
	row_id: Option<Uuid>,
	subject_did: &str,
) -> Result<(), String> {
	let chain = vault
		.identities
		.get(&owner)
		.ok_or_else(|| format!("unknown_identity:{owner}"))?;
	let identity_str = identity_urn_for(owner);
	let resource = match row_id {
		None => format!("{identity_str}:{table}"),
		Some(r) => format!("{identity_str}:{table}:{r}"),
	};

	// Replication peers (server avens) are authorized by an explicit `replicate`
	// grant, NOT by membership: they are not `owns`-admins and hold no keyshare, so
	// they carry ciphertext blind. This path deliberately bypasses the owner check
	// below — a replica must never need admin/membership to store-and-forward.
	if matches!(op, AccOp::Replicate) {
		return authorize_replicate(&chain.biscuit, &resource, subject_did);
	}

	let admins = trusted_subject_dids(&chain.biscuit, &identity_str)?;
	if !admins.iter().any(|a| peer_did_matches(a, subject_did)) {
		// Non-owner subject: the only thing it may hold is a *delegated* right
		// (admin-signed third-party block), not membership. A delegated `reads`
		// grant authorizes Read without `owns` — the same generalization
		// `authorize_replicate` makes for `replicate`. Any other op stays
		// owner-only. This is what lets an onboarded member read `admin-identity`
		// (the roster) without being an admin of it.
		// General granular grant: a subject-scoped `grant(did, op, prefix)` fact
		// authorizes ANY op on resources under `prefix` (e.g. a member's row-scoped
		// `write` on its own roster row). This is the unified delegated-right
		// mechanism — `reads`/`replicate` are the older specific forms kept below.
		if authorize_granted_op(&chain.biscuit, op.as_op_str(), &resource, subject_did).is_ok() {
			return Ok(());
		}
		if matches!(op, AccOp::Read) {
			return authorize_read_delegated(&chain.biscuit, &resource, subject_did);
		}
		return Err("identity_acc:subject_not_owner".into());
	}

	let trusted_body = admins
		.iter()
		.map(|d| {
			format!(
				"trusted_admin(\"{}\");",
				d.replace('\\', "\\\\").replace('"', "\\\"")
			)
		})
		.collect::<Vec<_>>()
		.concat();

	let op_s = op.as_op_str();

	let dsl = format!(
		r#"subject("{}");
op("{}");
resource("{}");

{trusted_body}

allow if subject($p), trusted_admin($p), op($op), resource($r), right($op, $prefix), $r.starts_with($prefix);
deny if true;
"#,
		subject_did.replace('\\', "\\\\").replace('"', "\\\""),
		op_s,
		resource.replace('\\', "\\\\").replace('"', "\\\""),
	);

	let mut a = AuthorizerBuilder::new()
		.code(&dsl)
		.map_err(|e| format!("authz-code:{e}"))?
		.time()
		.build(&chain.biscuit)
		.map_err(|e| format!("authz-build:{e}"))?;

	match a.authorize() {
		Ok(_) => Ok(()),
		Err(e) => Err(format!(
			"biscuit_deny:{}",
			format_failed_logic_compact(&e)
		)),
	}
}

/// Authorize a blind replication peer: allowed iff the chain carries a
/// `replicate($subject, $prefix)` grant whose prefix covers the resource. No
/// `owns`/`trusted_admin` is required — a replica is not a member.
///
/// The grant lives in a third-party attenuation block, whose facts are NOT in
/// scope for top-level authorizer `allow` rules — so (like `trusted_subject_dids`
/// does for `owns`) we `query_all` the grants out and check prefix coverage in
/// Rust rather than in datalog.
fn authorize_replicate(chain: &Biscuit, resource: &str, subject_did: &str) -> Result<(), String> {
	let mut authorizer = chain.authorizer().map_err(|e| format!("authz-rep-build:{e}"))?;
	let grants: Vec<(String, String)> = authorizer
		.query_all("granted($p, $pre) <- replicate($p, $pre)")
		.map_err(|e| format!("authz-rep-query:{e}"))?;
	let allowed = grants
		.iter()
		.any(|(did, prefix)| peer_did_matches(did, subject_did) && resource.starts_with(prefix));
	if allowed {
		Ok(())
	} else {
		Err("identity_acc:replicate_not_granted".into())
	}
}

/// Authorize a delegated reader: allowed iff the chain carries a
/// `reads($subject, $prefix)` grant whose prefix covers the resource. No
/// `owns`/`trusted_admin` required — a reader is a member but not an admin.
///
/// Mirror of [`authorize_replicate`]: the grant lives in a third-party
/// attenuation block (admin-signed), so we `query_all` it out and check prefix
/// coverage in Rust rather than in the top-level authorizer `allow` rule.
fn authorize_read_delegated(chain: &Biscuit, resource: &str, subject_did: &str) -> Result<(), String> {
	let mut authorizer = chain.authorizer().map_err(|e| format!("authz-read-build:{e}"))?;
	let grants: Vec<(String, String)> = authorizer
		.query_all("granted($p, $pre) <- reads($p, $pre)")
		.map_err(|e| format!("authz-read-query:{e}"))?;
	let allowed = grants
		.iter()
		.any(|(did, prefix)| peer_did_matches(did, subject_did) && resource.starts_with(prefix));
	if allowed {
		Ok(())
	} else {
		Err("identity_acc:read_not_granted".into())
	}
}

/// Append a third-party block granting `did` a **granular** right: it may perform
/// `op` on any resource under `prefix` (e.g. `op="write"`,
/// `prefix="identity:S:peers:ROWID"` = write only that one row). Signed by an admin
/// key. This is the unified delegated-right primitive — `owns`/`reads`/`replicate`
/// are the coarse special cases; this expresses any op at any resource scope
/// (per-identity, per-table, or per-row via the prefix).
pub fn attenuate_add_grant_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	grantee_did: &str,
	op: &str,
	prefix: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
	let f = format!("grant(\"{}\", \"{}\", \"{}\")", esc(grantee_did), esc(op), esc(prefix));
	let bb = BlockBuilder::new()
		.fact(f.as_str())
		.map_err(|e| format!("tp_grant_fact:{e}"))?;
	let block = req
		.create_block(&delegating_kp.private(), bb)
		.map_err(|e| format!("tp_grant_create:{e:?}"))?;
	chain
		.append_third_party(delegating_kp.public(), block)
		.map_err(|e| format!("tp_grant_append:{e:?}"))
}

/// Authorize a non-owner via a granular `grant($did, $op, $prefix)` fact whose op
/// matches and whose prefix covers the resource. Mirror of [`authorize_replicate`]
/// / [`authorize_read_delegated`] but op-generic (the grant carries its own op).
fn authorize_granted_op(chain: &Biscuit, op: &str, resource: &str, subject_did: &str) -> Result<(), String> {
	let mut authorizer = chain.authorizer().map_err(|e| format!("authz-grant-build:{e}"))?;
	let grants: Vec<(String, String, String)> = authorizer
		.query_all("granted($p, $op, $pre) <- grant($p, $op, $pre)")
		.map_err(|e| format!("authz-grant-query:{e}"))?;
	let allowed = grants.iter().any(|(did, gop, prefix)| {
		peer_did_matches(did, subject_did) && gop == op && resource.starts_with(prefix)
	});
	if allowed {
		Ok(())
	} else {
		Err(format!("identity_acc:op_not_granted:{op}"))
	}
}

/// All granular grants on a identity per the biscuit chain — `(did, op, prefix)` for
/// every `grant(...)` whose prefix is under this identity. Feeds the per-subject cap
/// report (so row-scoped/table-scoped grants surface in the UI).
pub fn identity_grants(chain: &Biscuit, owner: Uuid) -> Result<Vec<(String, String, String)>, String> {
	let identity_prefix = identity_urn_for(owner);
	let mut authorizer = chain.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rows: Vec<(String, String, String)> = authorizer
		.query_all("granted($p, $op, $pre) <- grant($p, $op, $pre)")
		.map_err(|e| format!("b-query-grant:{e}"))?;
	Ok(rows
		.into_iter()
		.filter(|(_, _, pre)| pre.starts_with(&identity_prefix))
		.collect())
}

fn format_failed_logic_compact(e: &biscuit_auth::error::Token) -> String {
	use std::fmt::Write;

	let mut buf = format!("{:?}", e);

	// Truncate monstrous verifier output — enough for diagnostics.
	const MAX: usize = 1800usize;
	if buf.len() > MAX {
		buf.truncate(MAX);
		let _ = write!(buf, "…");
	}
	buf
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Test vault from a fixed root (no tauri derive needed in the lib tests).
	fn vault(root: &[u8; 32]) -> BiscuitVault {
		build_vault_from_signing_key(&SigningKey::from_bytes(root)).unwrap()
	}
	#[test]
	fn genesis_then_authorize() {
		let root = [9u8; 32];
		let mut v = vault(&root);
		let sid = uuid::Uuid::new_v4();
		let biscuit = mint_genesis_identity(&v, sid).unwrap();
		v.identities.insert(
			sid,
			BiscuitIdentity {
				owner: sid,
				biscuit,
			},
		);
		authorize(&v, sid, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		assert!(authorize(
			&v,
			sid,
			AccOp::Write,
			"todos",
			Some(uuid::Uuid::nil()),
			"did:key:wrong"
		)
		.is_err());
	}

	#[test]
	fn genesis_then_authorize_delete() {
		let root = [9u8; 32];
		let mut v = vault(&root);
		let sid = uuid::Uuid::new_v4();
		let biscuit = mint_genesis_identity(&v, sid).unwrap();
		v.identities.insert(
			sid,
			BiscuitIdentity {
				owner: sid,
				biscuit,
			},
		);
		let rid = uuid::Uuid::new_v4();
		authorize(&v, sid, AccOp::Delete, "todos", Some(rid), &v.peer_did.clone()).unwrap();
	}

	#[test]
	fn third_party_grant_allows_second_device() {
		let root_alice = [1u8; 32];
		let root_bob = [2u8; 32];
		let mut alice = vault(&root_alice);
		let bob = vault(&root_bob);

		let sid = uuid::Uuid::new_v4();
		let genesis = mint_genesis_identity(&alice, sid).unwrap();
		let issuer_pk = alice.biscuit_kp.public();

		let chain = attenuate_add_owner_third_party(
			&alice.biscuit_kp,
			&genesis,
			sid,
			bob.peer_did.as_str(),
		)
		.unwrap();

		alice.identities.insert(
			sid,
			BiscuitIdentity {
				owner: sid,
				biscuit: chain.clone(),
			},
		);
		let mut bob_vault = BiscuitVault {
			biscuit_kp: bob.biscuit_kp,
			peer_did: bob.peer_did.clone(),
			ed25519_public: bob.ed25519_public,
			identities: std::collections::HashMap::new(),
		};
		bob_vault.identities.insert(
			sid,
			BiscuitIdentity {
				owner: sid,
				biscuit: chain,
			},
		);

		authorize(&alice, sid, AccOp::Write, "todos", None, &alice.peer_did).unwrap();
		authorize(&bob_vault, sid, AccOp::Write, "todos", None, &bob.peer_did).unwrap();
		let other = vault(&[33u8; 32]);
		assert!(authorize(&bob_vault, sid, AccOp::Write, "todos", None, &other.peer_did).is_err());

		let _ = issuer_pk;
	}

	/// Repro for the grant→2nd-device blocker: aven-node adds the first admin (A) with the
	/// ROOT key, then A grants a 2nd device (B) with A's OWN key — a SECOND third-party block
	/// stacked on the first. The chain is serialized (genesis_b64) and re-verified via
	/// `biscuit_from_storage` on every hydrate, so both round-trips must re-verify against the
	/// issuer root. This mirrors the app exactly (write genesis_b64 → Biscuit::from on rehydrate).
	#[test]
	fn stacked_owner_grants_reverify_against_root() {
		use base64::engine::general_purpose::URL_SAFE_NO_PAD;
		use base64::Engine;

		let server = vault(&[1u8; 32]); // avenCEO issuer / root
		let a = vault(&[2u8; 32]); // first admin
		let b = vault(&[3u8; 32]); // second device
		let sid = uuid::Uuid::new_v4();
		let issuer_pk = server.biscuit_kp.public();

		let genesis = mint_genesis_identity(&server, sid).unwrap();

		// aven-node adds A (delegating key = the server/root key).
		let chain1 = attenuate_add_owner_third_party(
			&server.biscuit_kp,
			&genesis,
			sid,
			a.peer_did.as_str(),
		)
		.unwrap();
		let b64_1 = URL_SAFE_NO_PAD.encode(chain1.to_vec().unwrap());
		let chain1_rt = biscuit_from_storage(&b64_1, issuer_pk)
			.expect("1-level grant chain must re-verify against root");

		// A adds B (delegating key = A's key, NOT the root) on the round-tripped chain.
		let chain2 = attenuate_add_owner_third_party(
			&a.biscuit_kp,
			&chain1_rt,
			sid,
			b.peer_did.as_str(),
		)
		.unwrap();
		let b64_2 = URL_SAFE_NO_PAD.encode(chain2.to_vec().unwrap());
		let chain2_rt = biscuit_from_storage(&b64_2, issuer_pk)
			.expect("2-level (stacked) grant chain must re-verify against root");

		assert!(identity_peer_is_owner(&chain2_rt, sid, a.peer_did.as_str()).unwrap());
		assert!(identity_peer_is_owner(&chain2_rt, sid, b.peer_did.as_str()).unwrap());
	}

	#[test]
	fn replicate_grant_carries_ciphertext_without_membership() {
		// Alice (owner) grants a server aven a `replicate` cap — NOT membership.
		let alice = vault(&[1u8; 32]);
		let server = vault(&[7u8; 32]);
		let outsider = vault(&[8u8; 32]);
		let sid = uuid::Uuid::new_v4();
		let rid = uuid::Uuid::new_v4();

		let genesis = mint_genesis_identity(&alice, sid).unwrap();
		let chain = attenuate_add_replicate_third_party(
			&alice.biscuit_kp,
			&genesis,
			sid,
			server.peer_did.as_str(),
		)
		.unwrap();
		let mut v = alice;
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		// The replica IS authorized to store-and-forward (Replicate) the identity's rows…
		authorize(&v, sid, AccOp::Replicate, "todos", Some(rid), &server.peer_did).unwrap();
		// …but is NOT a member: it can neither read nor write (no decryption / no edits).
		assert!(authorize(&v, sid, AccOp::Write, "todos", Some(rid), &server.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Read, "todos", Some(rid), &server.peer_did).is_err());
		// A DID with no replicate grant cannot store-and-forward.
		assert!(
			authorize(&v, sid, AccOp::Replicate, "todos", Some(rid), &outsider.peer_did).is_err()
		);
		// And holding `replicate` does NOT confer membership to a real member check:
		// the owner still works as a member.
		authorize(&v, sid, AccOp::Write, "todos", Some(rid), &v.peer_did.clone()).unwrap();
	}

	#[test]
	fn reader_grant_allows_read_without_membership() {
		// Alice (owner) grants a reader (an onboarded member) a `reads` cap — NOT
		// membership/ownership. The reader may Read but not Write/Delete/Replicate.
		let alice = vault(&[1u8; 32]);
		let reader = vault(&[5u8; 32]);
		let outsider = vault(&[8u8; 32]);
		let sid = uuid::Uuid::new_v4();
		let rid = uuid::Uuid::new_v4();

		let genesis = mint_genesis_identity(&alice, sid).unwrap();
		let chain =
			attenuate_add_reader_third_party(&alice.biscuit_kp, &genesis, sid, reader.peer_did.as_str())
				.unwrap();
		let mut v = alice;
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		// Enumerated as a reader.
		let readers = identity_readers(&v.identities.get(&sid).unwrap().biscuit, sid).unwrap();
		assert!(readers.iter().any(|d| peer_did_matches(d, &reader.peer_did)), "reader listed");

		// The reader IS authorized to Read…
		authorize(&v, sid, AccOp::Read, "peers", Some(rid), &reader.peer_did).unwrap();
		// …but is NOT a member/admin: no write, no delete, no replicate.
		assert!(authorize(&v, sid, AccOp::Write, "peers", Some(rid), &reader.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Delete, "peers", Some(rid), &reader.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Replicate, "peers", Some(rid), &reader.peer_did).is_err());
		// A DID with no reads grant cannot read.
		assert!(authorize(&v, sid, AccOp::Read, "peers", Some(rid), &outsider.peer_did).is_err());
		// The owner still reads + writes as a full member.
		authorize(&v, sid, AccOp::Read, "peers", Some(rid), &v.peer_did.clone()).unwrap();
		authorize(&v, sid, AccOp::Write, "peers", Some(rid), &v.peer_did.clone()).unwrap();
	}

	#[test]
	fn writer_grant_denies_delete() {
		// Audit #6: a peer granted a granular WRITE-ONLY cap must NOT be able to author a
		// delete. The inbound apply gate now requests `AccOp::Delete` for delete-flagged rows
		// (`inbox.rs`) and the app resolver honors it instead of re-coercing to `Write`
		// (`biscuit_resolver.rs`); this proves the cap layer those call into truly separates
		// Write from Delete for the exact granular writer in the attack.
		let owner = vault(&[1u8; 32]);
		let writer = vault(&[5u8; 32]);
		let sid = uuid::Uuid::new_v4();
		let row = uuid::Uuid::from_u128(0x4242);

		let genesis = mint_genesis_identity(&owner, sid).unwrap();
		// Granular write-only grant over one user-data row (the destructive-delete target).
		let prefix = format!("identity:{sid}:todos:{row}");
		let chain = attenuate_add_grant_third_party(
			&owner.biscuit_kp,
			&genesis,
			&writer.peer_did,
			"write",
			&prefix,
		)
		.unwrap();
		let mut v = owner;
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		// The write-only peer may Write its granted row…
		authorize(&v, sid, AccOp::Write, "todos", Some(row), &writer.peer_did).unwrap();
		// …but is DENIED Delete — it cannot self-author the hard-delete the inbox now gates
		// under `AccOp::Delete`.
		assert!(
			authorize(&v, sid, AccOp::Delete, "todos", Some(row), &writer.peer_did).is_err(),
			"a write-only granular grant must NOT confer Delete"
		);
		// The owner retains Delete (full member); the granular grant doesn't shadow ownership.
		authorize(&v, sid, AccOp::Delete, "todos", Some(row), &v.peer_did.clone()).unwrap();
	}

	#[test]
	fn aven_ceo_identity_is_deterministic_per_seed() {
		let a = aven_ceo_identity("ceo.aven/testnet/abagana");
		let b = aven_ceo_identity("ceo.aven/testnet/abagana");
		let c = aven_ceo_identity("ceo.aven/mainnet/other");
		assert_eq!(a, b, "same seed → same avenCEO id (every device agrees)");
		assert_ne!(a, c, "different network seed → different avenCEO id (no cross-network collision)");
		assert_ne!(a, Uuid::nil());
	}

	#[test]
	fn subgroup_id_is_deterministic_and_isolated() {
		let seed = "ceo.aven/testnet/abagana";
		let ceo = aven_ceo_identity(seed);
		// Deterministic — every peer derives the same registry-group id with no coordination.
		assert_eq!(aven_ceo_registry_group(seed), aven_ceo_registry_group(seed));
		assert_eq!(aven_ceo_registry_group(seed), derive_subgroup_id(ceo, "registry"));
		// A sub-group is its OWN key boundary: distinct from the parent identity...
		assert_ne!(aven_ceo_registry_group(seed), ceo, "registry group != identity (own DEK boundary)");
		// ...and from sibling labels (registry vs a future data group).
		assert_ne!(
			derive_subgroup_id(ceo, "registry"),
			derive_subgroup_id(ceo, "messages"),
			"distinct labels -> distinct groups"
		);
		// Parent-scoped: same label under a different parent → different group (no collision).
		let other = aven_ceo_identity("ceo.aven/mainnet/other");
		assert_ne!(derive_subgroup_id(ceo, "registry"), derive_subgroup_id(other, "registry"));
		assert_ne!(aven_ceo_registry_group(seed), Uuid::nil());
	}

	#[test]
	fn group_genesis_extends_parent_and_grants_owner() {
		let root = [7u8; 32];
		let mut v = vault(&root);
		let parent = aven_ceo_identity("ceo.aven/testnet/abagana");
		let group = derive_subgroup_id(parent, "registry");
		let biscuit = mint_group_genesis_extending(&v, group, parent).unwrap();
		// The genesis records the parent it extends (the inheritance link).
		assert_eq!(group_extends_parent(&biscuit).unwrap(), Some(parent));
		// The creator is the group's owner — full rights over the GROUP's own prefix.
		v.identities.insert(group, BiscuitIdentity { owner: group, biscuit });
		authorize(&v, group, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		// A plain identity genesis has no parent (it is a root group).
		let id = uuid::Uuid::new_v4();
		let plain = mint_genesis_identity(&v, id).unwrap();
		assert_eq!(group_extends_parent(&plain).unwrap(), None);
	}

	#[test]
	fn group_inherits_parent_members() {
		let mut v = vault(&[11u8; 32]); // creator / admin
		let reader = vault(&[12u8; 32]); // a parent member (delegated reader)
		let outsider = vault(&[13u8; 32]); // member of neither

		// Parent identity owned by `v`, with `reader` added as a delegated reader.
		let parent = uuid::Uuid::new_v4();
		let mut pb = mint_genesis_identity(&v, parent).unwrap();
		pb = attenuate_add_reader_third_party(&v.biscuit_kp, &pb, parent, &reader.peer_did).unwrap();
		v.identities.insert(parent, BiscuitIdentity { owner: parent, biscuit: pb });

		// A sub-group (collection-level) that EXTENDS the parent.
		let group = derive_subgroup_id(parent, "todos");
		let gb = mint_group_genesis_extending(&v, group, parent).unwrap();
		v.identities.insert(group, BiscuitIdentity { owner: group, biscuit: gb });

		// Inheritance: the parent's reader may READ the sub-group with NO per-group grant.
		authorize(&v, group, AccOp::Read, "todos", Some(uuid::Uuid::new_v4()), &reader.peer_did).unwrap();
		// The creator (parent owner) may WRITE the sub-group (its own `owns`).
		authorize(&v, group, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		// An outsider (member of neither parent nor group) is DENIED — inheritance is bounded.
		assert!(authorize(&v, group, AccOp::Read, "todos", Some(uuid::Uuid::new_v4()), &outsider.peer_did).is_err());
	}

	#[test]
	fn granular_row_scoped_write_grant() {
		// The self-publish primitive: a member gets write ONLY on its own roster row.
		let owner = vault(&[1u8; 32]);
		let member = vault(&[5u8; 32]);
		let sid = uuid::Uuid::new_v4();
		let own_row = uuid::Uuid::from_u128(0x1111_2222);
		let other_row = uuid::Uuid::from_u128(0x3333_4444);

		let genesis = mint_genesis_identity(&owner, sid).unwrap();
		let prefix = format!("identity:{sid}:peers:{own_row}");
		let chain = attenuate_add_grant_third_party(
			&owner.biscuit_kp,
			&genesis,
			&member.peer_did,
			"write",
			&prefix,
		)
		.unwrap();
		let mut v = owner;
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		// Member may write its OWN row…
		authorize(&v, sid, AccOp::Write, "peers", Some(own_row), &member.peer_did).unwrap();
		// …but NOT another row, NOT another table, NOT read, NOT delete.
		assert!(authorize(&v, sid, AccOp::Write, "peers", Some(other_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Write, "todos", Some(own_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Read, "peers", Some(own_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Delete, "peers", Some(own_row), &member.peer_did).is_err());
		// Owner keeps full access (the granular grant doesn't shadow ownership).
		authorize(&v, sid, AccOp::Write, "peers", Some(other_row), &v.peer_did.clone()).unwrap();

		// Enumerated by identity_grants for the cap report.
		let grants = identity_grants(&v.identities.get(&sid).unwrap().biscuit, sid).unwrap();
		assert!(grants
			.iter()
			.any(|(d, o, p)| peer_did_matches(d, &member.peer_did) && o == "write" && p == &prefix));
	}

	#[test]
	fn cap_report_reflects_biscuit_grants() {
		let owner = vault(&[1u8; 32]);
		let reader = vault(&[5u8; 32]);
		let replica = vault(&[7u8; 32]);
		let sid = uuid::Uuid::new_v4();

		let mut chain = mint_genesis_identity(&owner, sid).unwrap();
		chain = attenuate_add_reader_third_party(&owner.biscuit_kp, &chain, sid, &reader.peer_did).unwrap();
		chain = attenuate_add_replicate_third_party(&owner.biscuit_kp, &chain, sid, &replica.peer_did).unwrap();

		let report = identity_cap_report(&chain, sid).unwrap();
		// Single source: owner caps == OWNER_RIGHTS, reader == [read], replica == [replicate].
		let owner_rights: Vec<String> = OWNER_RIGHTS.iter().map(|s| s.to_string()).collect();
		let o = report.iter().find(|s| peer_did_matches(&s.did, &owner.peer_did)).unwrap();
		assert_eq!(o.grant, "owns");
		assert_eq!(o.caps, owner_rights);
		let r = report.iter().find(|s| peer_did_matches(&s.did, &reader.peer_did)).unwrap();
		assert_eq!(r.grant, "reads");
		assert_eq!(r.caps, vec!["read".to_string()]);
		let p = report.iter().find(|s| peer_did_matches(&s.did, &replica.peer_did)).unwrap();
		assert_eq!(p.grant, "replicate");
		// A relay's effective caps now report the bounds its grant implies on the aven:
		// the blind `replicate` + a per-identity 10 MB `quota` + inbound `rate_limit`.
		assert_eq!(
			p.caps,
			vec![
				"replicate".to_string(),
				"quota".to_string(),
				"rate_limit".to_string()
			]
		);
	}

	#[test]
	fn rebuild_excluding_revokes_one_admin_keeps_owner_and_rest() {
		// Alice (owner) grants Bob and Carol, then revokes Bob via re-mint.
		let alice = vault(&[1u8; 32]);
		let bob = vault(&[2u8; 32]);
		let carol = vault(&[3u8; 32]);
		let sid = uuid::Uuid::new_v4();

		let mut chain = mint_genesis_identity(&alice, sid).unwrap();
		chain = attenuate_add_owner_third_party(&alice.biscuit_kp, &chain, sid, &bob.peer_did).unwrap();
		chain =
			attenuate_add_owner_third_party(&alice.biscuit_kp, &chain, sid, &carol.peer_did).unwrap();

		let mut v = alice;
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: chain });

		// Sanity: all three authorized before revoke.
		authorize(&v, sid, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &bob.peer_did).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &carol.peer_did).unwrap();

		// Revoke Bob: re-mint excluding Bob.
		let rebuilt = rebuild_identity_biscuit_excluding(&v, sid, &bob.peer_did).unwrap();
		let admins = identity_admins(&rebuilt, sid).unwrap();
		assert!(admins.iter().any(|d| peer_did_matches(d, &v.peer_did)), "owner kept");
		assert!(admins.iter().any(|d| peer_did_matches(d, &carol.peer_did)), "carol kept");
		assert!(!admins.iter().any(|d| peer_did_matches(d, &bob.peer_did)), "bob removed");

		// Authorize against the rebuilt chain: owner + carol allowed, bob denied.
		v.identities.insert(sid, BiscuitIdentity { owner: sid, biscuit: rebuilt });
		authorize(&v, sid, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &carol.peer_did).unwrap();
		assert!(
			authorize(&v, sid, AccOp::Write, "todos", None, &bob.peer_did).is_err(),
			"revoked Bob must be denied on the rebuilt biscuit"
		);
	}
}
