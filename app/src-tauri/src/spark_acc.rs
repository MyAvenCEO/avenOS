//! Offline capability gates (biscuit) for spark-scoped IPC.

use std::collections::HashSet;

use base64::engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine;
use biscuit_auth::{
	builder::{Algorithm, AuthorizerBuilder, BlockBuilder},
	Biscuit, KeyPair, PublicKey,
};
use crate::jazz_auth;
use uuid::Uuid;

#[derive(Clone)]
pub struct BiscuitSpark {
	#[allow(dead_code)]
	pub spark_id: Uuid,
	pub biscuit: Biscuit,
}

pub struct BiscuitVault {
	pub biscuit_kp: KeyPair,
	pub peer_did: String,
	pub ed25519_public: [u8; 32],
	pub sparks: std::collections::HashMap<Uuid, BiscuitSpark>,
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
}

impl AccOp {
	fn as_op_str(self) -> &'static str {
		match self {
			AccOp::Read => "read",
			AccOp::Write => "write",
			AccOp::Delete => "delete",
			AccOp::Replicate => "replicate",
		}
	}
}

fn spark_urn_for(spark_id: Uuid) -> String {
	format!("spark:{spark_id}")
}

/// Display name of the well-known network control spark.
pub const AVEN_CEO_SPARK_NAME: &str = "avenCEO";

/// Deterministic id of the well-known network control spark (**`avenCEO`**, the
/// roster/membership spark), derived from the network seed. Every device in a
/// network computes the **same** id, so the spark can be shown by default and
/// **claimed** before anyone has synced: the first device to mint its genesis
/// becomes the owner (claim-once). Per-network (the seed scopes it), so distinct
/// networks don't collide on one id. Uses SHA-256 (the `uuid` crate's `v5` feature
/// isn't enabled) — stable across builds for a given seed.
pub fn aven_ceo_spark_id(network_seed: &str) -> Uuid {
	use sha2::{Digest, Sha256};
	let mut h = Sha256::new();
	h.update(b"avenos:avenCEO:v1:");
	h.update(network_seed.trim().as_bytes());
	let digest = h.finalize();
	let mut bytes = [0u8; 16];
	bytes.copy_from_slice(&digest[..16]);
	Uuid::from_bytes(bytes)
}

/// The rights a spark **owner** holds, minted into the genesis biscuit. THE single
/// source of truth for the rights vocabulary: [`mint_genesis_spark`] grants exactly
/// these, and [`spark_cap_report`] reports exactly these for an owner, so genesis
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

/// One subject's effective caps on a spark, derived purely from the biscuit chain.
pub struct SubjectCaps {
	pub did: String,
	/// `owns` | `reads` | `replicate`
	pub grant: &'static str,
	pub caps: Vec<&'static str>,
}

/// THE single source of truth for "who holds what cap on this spark": read the
/// biscuit chain (`owns`/`reads`/`replicate` grants) and report each subject's
/// grant + effective caps. Owners take precedence — a DID that is both an owner
/// and a reader/replica shows once, as owner. Sorted by grant then DID.
pub fn spark_cap_report(chain: &Biscuit, spark_id: Uuid) -> Result<Vec<SubjectCaps>, String> {
	let owners = spark_admins(chain, spark_id)?;
	let owner_set: HashSet<String> = owners.iter().map(|d| d.trim().to_string()).collect();
	let mut out: Vec<SubjectCaps> = Vec::new();

	let mut owners_sorted: Vec<String> = owners.into_iter().collect();
	owners_sorted.sort();
	for did in owners_sorted {
		out.push(SubjectCaps { did, grant: "owns", caps: grant_kind_caps("owns") });
	}

	let mut readers: Vec<String> = spark_readers(chain, spark_id)?
		.into_iter()
		.filter(|d| !owner_set.contains(d.trim()))
		.collect();
	readers.sort();
	for did in readers {
		out.push(SubjectCaps { did, grant: "reads", caps: grant_kind_caps("reads") });
	}

	let mut replicas: Vec<String> = spark_replicas(chain, spark_id)?
		.into_iter()
		.filter(|d| !owner_set.contains(d.trim()))
		.collect();
	replicas.sort();
	for did in replicas {
		out.push(SubjectCaps { did, grant: "replicate", caps: grant_kind_caps("replicate") });
	}
	Ok(out)
}

pub fn biscuit_keypair_from_ed25519_signing(secret32: &[u8; 32]) -> Result<KeyPair, String> {
	KeyPair::from_bytes(secret32, Algorithm::Ed25519.into()).map_err(|e| format!("biscuit-kp-from-bytes:{e:?}"))
}

pub fn encode_issuer_pubkey_b64(pubkey: &PublicKey) -> String {
	URL_SAFE_NO_PAD.encode(pubkey.to_bytes())
}

/// Decode verifier root pubkey stored in [`sparks.issuer_pubkey_b64`].
pub fn decode_issuer_pubkey_b64(b64: &str) -> Result<PublicKey, String> {
	let trimmed = b64.trim();
	if trimmed.is_empty() {
		return Err("issuer_pubkey_b64_empty".into());
	}
	let raw = URL_SAFE_NO_PAD
		.decode(trimmed.as_bytes())
		.or_else(|_| STANDARD_NO_PAD.decode(trimmed.as_bytes()))
		.map_err(|e| format!("issuer_pubkey_b64_decode:{e}"))?;
	PublicKey::from_bytes(raw.as_slice(), Algorithm::Ed25519.into()).map_err(|e| format!("issuer_pubkey_bad:{e:?}"))
}

pub fn build_vault_from_root(root: &[u8; 32]) -> Result<BiscuitVault, String> {
	let sk_ed = jazz_auth::signing_key_from_device_root(root)?;
	let pk_arr = sk_ed.verifying_key().to_bytes();

	let biscuit_kp =
		biscuit_keypair_from_ed25519_signing(sk_ed.as_bytes())?;

	let peer_did =
		jazz_auth::peer_did_from_ed25519(&pk_arr)?;

	Ok(BiscuitVault {
		biscuit_kp,
		peer_did,
		ed25519_public: pk_arr,
		sparks: std::collections::HashMap::new(),
	})
}

pub fn mint_genesis_spark(
	vault: &BiscuitVault,
	spark_id: Uuid,
) -> Result<Biscuit, String> {
	let spark_urn = spark_urn_for(spark_id);
	let prefix_lit = format!("{spark_urn}:");
	let own_f = format!(
			"owns(\"{}\", \"{}\")",
			vault.peer_did.replace('"', "\\\""),
			spark_urn.replace('"', "\\\"")
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

/// Append a third-party biscuit block granting `new_peer_did` an [`owns`] fact on this Spark,
/// signed by `delegating_kp` (typically the device's biscuit [`KeyPair`], i.e. same key that
/// anchored the genesis or a prior delegated admin's key — see biscuit third-party semantics).
pub fn attenuate_add_owner_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	spark_id: Uuid,
	new_peer_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let spark_str = spark_urn_for(spark_id);
	let own_f = format!(
		"owns(\"{}\", \"{}\")",
		new_peer_did.replace('\\', "\\\\").replace('"', "\\\""),
		spark_str.replace('\\', "\\\\").replace('"', "\\\"")
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
/// this Spark's resource prefix, signed by `delegating_kp` (an admin's biscuit
/// key). Unlike [`attenuate_add_owner_third_party`] this grants **no `owns`** and
/// implies **no keyshare** — the holder may store & forward the spark's encrypted
/// batches (blind relay / backup) but is not a member and cannot decrypt.
pub fn attenuate_add_replicate_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	spark_id: Uuid,
	replica_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let prefix = format!("{}:", spark_urn_for(spark_id));
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
/// Spark's resource prefix, signed by `delegating_kp` (an admin's biscuit key).
/// Grants **no `owns`** — the reader is a member who may decrypt (pair this with
/// a keyshare) but is **not** an admin and cannot write. This is the
/// "membership credential" an onboarded peer holds on `admin-spark`: it lets the
/// peer read the roster and marks it admitted (the server enumerates readers via
/// [`spark_readers`] to gate admission).
pub fn attenuate_add_reader_third_party(
	delegating_kp: &KeyPair,
	chain: &Biscuit,
	spark_id: Uuid,
	reader_did: &str,
) -> Result<Biscuit, String> {
	let req = chain
		.third_party_request()
		.map_err(|e| format!("tp_request:{e:?}"))?;
	let prefix = format!("{}:", spark_urn_for(spark_id));
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

/// All delegated-reader DIDs granted on a spark per the biscuit chain (members
/// who hold a `reads` grant but are not owners). The server reads this on
/// `admin-spark` to build its admission allowlist.
pub fn spark_readers(chain: &Biscuit, spark_id: Uuid) -> Result<HashSet<String>, String> {
	let prefix = format!("{}:", spark_urn_for(spark_id));
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

/// All replication-peer DIDs granted on a spark per the biscuit chain.
pub fn spark_replicas(chain: &Biscuit, spark_id: Uuid) -> Result<HashSet<String>, String> {
	let prefix = format!("{}:", spark_urn_for(spark_id));
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

/// Re-mint a spark biscuit granting every current admin EXCEPT `exclude_did`
/// (v2 revoke). Genesis re-grants the owner (`vault.peer_did`); every other
/// remaining admin is re-appended. The excluded DID is simply not re-granted, so
/// the new chain's `owns` set no longer contains it → `authorize` denies it.
/// Pair with DEK rotation so the revoked peer also cannot decrypt new data.
///
/// NOTE: must be called by the genesis owner — `mint_genesis_spark` re-roots the
/// chain to `vault.biscuit_kp`, so a delegated (non-owner) admin cannot rebuild.
pub fn rebuild_spark_biscuit_excluding(
	vault: &BiscuitVault,
	spark_id: Uuid,
	exclude_did: &str,
) -> Result<Biscuit, String> {
	let chain = vault
		.sparks
		.get(&spark_id)
		.ok_or_else(|| format!("unknown_spark:{spark_id}"))?;
	let admins = spark_admins(&chain.biscuit, spark_id)?;
	let mut biscuit = mint_genesis_spark(vault, spark_id)?;
	// Genesis already grants the owner; re-append every other admin except the
	// revoked one. Sort for deterministic order (HashSet iteration is unstable).
	let mut remaining: Vec<String> = admins
		.into_iter()
		.filter(|d| !peer_did_matches(d, exclude_did) && !peer_did_matches(d, &vault.peer_did))
		.collect();
	remaining.sort();
	for did in remaining {
		biscuit = attenuate_add_owner_third_party(&vault.biscuit_kp, &biscuit, spark_id, &did)?;
	}
	Ok(biscuit)
}

/// Ingest a spark biscuit after optional DEK unwrap (hydrate / migration paths).
pub fn ingest_genesis_opened(
	vault: &mut BiscuitVault,
	spark_id: Uuid,
	genesis_b64: &str,
	issuer_pubkey_b64: Option<&str>,
	local_fallback_issuer_pk: PublicKey,
) -> Result<(), String> {
	let issuer_pk = match issuer_pubkey_b64 {
		Some(s) if !s.trim().is_empty() => decode_issuer_pubkey_b64(s)?,
		_ => local_fallback_issuer_pk,
	};
	let biscuit = biscuit_from_storage(genesis_b64, issuer_pk)?;
	vault.sparks.insert(
		spark_id,
		BiscuitSpark {
			spark_id,
			biscuit,
		},
	);
	Ok(())
}

fn peer_did_matches(a: &str, b: &str) -> bool {
	a.trim() == b.trim()
}

pub fn spark_peer_is_owner(chain: &Biscuit, spark_id: Uuid, peer_did: &str) -> Result<bool, String> {
	let spark_str = spark_urn_for(spark_id);
	let admins = trusted_subject_dids(chain, &spark_str)?;
	Ok(admins.iter().any(|a| peer_did_matches(a, peer_did)))
}

/// All admin (`owns`) DIDs for a spark per the biscuit chain.
pub fn spark_admins(chain: &Biscuit, spark_id: Uuid) -> Result<std::collections::HashSet<String>, String> {
	let spark_str = spark_urn_for(spark_id);
	trusted_subject_dids(chain, &spark_str)
}

pub fn biscuit_from_storage(genesis_b64: &str, root: PublicKey) -> Result<Biscuit, String> {
	let raw = URL_SAFE_NO_PAD
		.decode(genesis_b64.as_bytes())
		.or_else(|_| STANDARD_NO_PAD.decode(genesis_b64.as_bytes()))
		.map_err(|e| format!("genesis-base64:{e}"))?;

	Biscuit::from(raw.as_slice(), root).map_err(|e| format!("biscuit-from:{e:?}"))
}

fn trusted_subject_dids(b: &Biscuit, spark_urn: &str) -> Result<HashSet<String>, String> {
	let mut authorizer =
		b.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rule = format!(r#"peers($p) <- owns($p, "{spark}")"#, spark = spark_urn);
	let admins: Vec<(String,)> = authorizer
		.query_all(rule.as_str())
		.map_err(|e| format!("b-query-own:{e}"))?;
	Ok(admins.into_iter().map(|x| x.0).collect())
}

pub fn authorize(
	vault: &BiscuitVault,
	spark_id: Uuid,
	op: AccOp,
	table: &str,
	row_id: Option<Uuid>,
	subject_did: &str,
) -> Result<(), String> {
	let chain = vault
		.sparks
		.get(&spark_id)
		.ok_or_else(|| format!("unknown_spark:{spark_id}"))?;
	let spark_str = spark_urn_for(spark_id);
	let resource = match row_id {
		None => format!("{spark_str}:{table}"),
		Some(r) => format!("{spark_str}:{table}:{r}"),
	};

	// Replication peers (server avens) are authorized by an explicit `replicate`
	// grant, NOT by membership: they are not `owns`-admins and hold no keyshare, so
	// they carry ciphertext blind. This path deliberately bypasses the owner check
	// below — a replica must never need admin/membership to store-and-forward.
	if matches!(op, AccOp::Replicate) {
		return authorize_replicate(&chain.biscuit, &resource, subject_did);
	}

	let admins = trusted_subject_dids(&chain.biscuit, &spark_str)?;
	if !admins.iter().any(|a| peer_did_matches(a, subject_did)) {
		// Non-owner subject: the only thing it may hold is a *delegated* right
		// (admin-signed third-party block), not membership. A delegated `reads`
		// grant authorizes Read without `owns` — the same generalization
		// `authorize_replicate` makes for `replicate`. Any other op stays
		// owner-only. This is what lets an onboarded member read `admin-spark`
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
		return Err("spark_acc:subject_not_owner".into());
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
		Err("spark_acc:replicate_not_granted".into())
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
		Err("spark_acc:read_not_granted".into())
	}
}

/// Append a third-party block granting `did` a **granular** right: it may perform
/// `op` on any resource under `prefix` (e.g. `op="write"`,
/// `prefix="spark:S:peers:ROWID"` = write only that one row). Signed by an admin
/// key. This is the unified delegated-right primitive — `owns`/`reads`/`replicate`
/// are the coarse special cases; this expresses any op at any resource scope
/// (per-spark, per-table, or per-row via the prefix).
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
		Err(format!("spark_acc:op_not_granted:{op}"))
	}
}

/// All granular grants on a spark per the biscuit chain — `(did, op, prefix)` for
/// every `grant(...)` whose prefix is under this spark. Feeds the per-subject cap
/// report (so row-scoped/table-scoped grants surface in the UI).
pub fn spark_grants(chain: &Biscuit, spark_id: Uuid) -> Result<Vec<(String, String, String)>, String> {
	let spark_prefix = spark_urn_for(spark_id);
	let mut authorizer = chain.authorizer().map_err(|e| format!("b-authorizer:{e}"))?;
	let rows: Vec<(String, String, String)> = authorizer
		.query_all("granted($p, $op, $pre) <- grant($p, $op, $pre)")
		.map_err(|e| format!("b-query-grant:{e}"))?;
	Ok(rows
		.into_iter()
		.filter(|(_, _, pre)| pre.starts_with(&spark_prefix))
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
	#[test]
	fn genesis_then_authorize() {
		let root = [9u8; 32];
		let mut v = build_vault_from_root(&root).unwrap();
		let sid = uuid::Uuid::new_v4();
		let biscuit = mint_genesis_spark(&v, sid).unwrap();
		v.sparks.insert(
			sid,
			BiscuitSpark {
				spark_id: sid,
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
		let mut v = build_vault_from_root(&root).unwrap();
		let sid = uuid::Uuid::new_v4();
		let biscuit = mint_genesis_spark(&v, sid).unwrap();
		v.sparks.insert(
			sid,
			BiscuitSpark {
				spark_id: sid,
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
		let mut alice = build_vault_from_root(&root_alice).unwrap();
		let bob = build_vault_from_root(&root_bob).unwrap();

		let sid = uuid::Uuid::new_v4();
		let genesis = mint_genesis_spark(&alice, sid).unwrap();
		let issuer_pk = alice.biscuit_kp.public();

		let chain = attenuate_add_owner_third_party(
			&alice.biscuit_kp,
			&genesis,
			sid,
			bob.peer_did.as_str(),
		)
		.unwrap();

		alice.sparks.insert(
			sid,
			BiscuitSpark {
				spark_id: sid,
				biscuit: chain.clone(),
			},
		);
		let mut bob_vault = BiscuitVault {
			biscuit_kp: bob.biscuit_kp,
			peer_did: bob.peer_did.clone(),
			ed25519_public: bob.ed25519_public,
			sparks: std::collections::HashMap::new(),
		};
		bob_vault.sparks.insert(
			sid,
			BiscuitSpark {
				spark_id: sid,
				biscuit: chain,
			},
		);

		authorize(&alice, sid, AccOp::Write, "todos", None, &alice.peer_did).unwrap();
		authorize(&bob_vault, sid, AccOp::Write, "todos", None, &bob.peer_did).unwrap();
		let other = build_vault_from_root(&[33u8; 32]).unwrap();
		assert!(authorize(&bob_vault, sid, AccOp::Write, "todos", None, &other.peer_did).is_err());

		let _ = issuer_pk;
	}

	#[test]
	fn replicate_grant_carries_ciphertext_without_membership() {
		// Alice (owner) grants a server aven a `replicate` cap — NOT membership.
		let alice = build_vault_from_root(&[1u8; 32]).unwrap();
		let server = build_vault_from_root(&[7u8; 32]).unwrap();
		let outsider = build_vault_from_root(&[8u8; 32]).unwrap();
		let sid = uuid::Uuid::new_v4();
		let rid = uuid::Uuid::new_v4();

		let genesis = mint_genesis_spark(&alice, sid).unwrap();
		let chain = attenuate_add_replicate_third_party(
			&alice.biscuit_kp,
			&genesis,
			sid,
			server.peer_did.as_str(),
		)
		.unwrap();
		let mut v = alice;
		v.sparks.insert(sid, BiscuitSpark { spark_id: sid, biscuit: chain });

		// The replica IS authorized to store-and-forward (Replicate) the spark's rows…
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
		let alice = build_vault_from_root(&[1u8; 32]).unwrap();
		let reader = build_vault_from_root(&[5u8; 32]).unwrap();
		let outsider = build_vault_from_root(&[8u8; 32]).unwrap();
		let sid = uuid::Uuid::new_v4();
		let rid = uuid::Uuid::new_v4();

		let genesis = mint_genesis_spark(&alice, sid).unwrap();
		let chain =
			attenuate_add_reader_third_party(&alice.biscuit_kp, &genesis, sid, reader.peer_did.as_str())
				.unwrap();
		let mut v = alice;
		v.sparks.insert(sid, BiscuitSpark { spark_id: sid, biscuit: chain });

		// Enumerated as a reader.
		let readers = spark_readers(&v.sparks.get(&sid).unwrap().biscuit, sid).unwrap();
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
	fn aven_ceo_spark_id_is_deterministic_per_seed() {
		let a = aven_ceo_spark_id("ceo.aven/testnet/abagana");
		let b = aven_ceo_spark_id("ceo.aven/testnet/abagana");
		let c = aven_ceo_spark_id("ceo.aven/mainnet/other");
		assert_eq!(a, b, "same seed → same avenCEO id (every device agrees)");
		assert_ne!(a, c, "different network seed → different avenCEO id (no cross-network collision)");
		assert_ne!(a, Uuid::nil());
	}

	#[test]
	fn granular_row_scoped_write_grant() {
		// The self-publish primitive: a member gets write ONLY on its own roster row.
		let owner = build_vault_from_root(&[1u8; 32]).unwrap();
		let member = build_vault_from_root(&[5u8; 32]).unwrap();
		let sid = uuid::Uuid::new_v4();
		let own_row = uuid::Uuid::from_u128(0x1111_2222);
		let other_row = uuid::Uuid::from_u128(0x3333_4444);

		let genesis = mint_genesis_spark(&owner, sid).unwrap();
		let prefix = format!("spark:{sid}:peers:{own_row}");
		let chain = attenuate_add_grant_third_party(
			&owner.biscuit_kp,
			&genesis,
			&member.peer_did,
			"write",
			&prefix,
		)
		.unwrap();
		let mut v = owner;
		v.sparks.insert(sid, BiscuitSpark { spark_id: sid, biscuit: chain });

		// Member may write its OWN row…
		authorize(&v, sid, AccOp::Write, "peers", Some(own_row), &member.peer_did).unwrap();
		// …but NOT another row, NOT another table, NOT read, NOT delete.
		assert!(authorize(&v, sid, AccOp::Write, "peers", Some(other_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Write, "todos", Some(own_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Read, "peers", Some(own_row), &member.peer_did).is_err());
		assert!(authorize(&v, sid, AccOp::Delete, "peers", Some(own_row), &member.peer_did).is_err());
		// Owner keeps full access (the granular grant doesn't shadow ownership).
		authorize(&v, sid, AccOp::Write, "peers", Some(other_row), &v.peer_did.clone()).unwrap();

		// Enumerated by spark_grants for the cap report.
		let grants = spark_grants(&v.sparks.get(&sid).unwrap().biscuit, sid).unwrap();
		assert!(grants
			.iter()
			.any(|(d, o, p)| peer_did_matches(d, &member.peer_did) && o == "write" && p == &prefix));
	}

	#[test]
	fn cap_report_reflects_biscuit_grants() {
		let owner = build_vault_from_root(&[1u8; 32]).unwrap();
		let reader = build_vault_from_root(&[5u8; 32]).unwrap();
		let replica = build_vault_from_root(&[7u8; 32]).unwrap();
		let sid = uuid::Uuid::new_v4();

		let mut chain = mint_genesis_spark(&owner, sid).unwrap();
		chain = attenuate_add_reader_third_party(&owner.biscuit_kp, &chain, sid, &reader.peer_did).unwrap();
		chain = attenuate_add_replicate_third_party(&owner.biscuit_kp, &chain, sid, &replica.peer_did).unwrap();

		let report = spark_cap_report(&chain, sid).unwrap();
		// Single source: owner caps == OWNER_RIGHTS, reader == [read], replica == [replicate].
		let o = report.iter().find(|s| peer_did_matches(&s.did, &owner.peer_did)).unwrap();
		assert_eq!(o.grant, "owns");
		assert_eq!(o.caps, OWNER_RIGHTS.to_vec());
		let r = report.iter().find(|s| peer_did_matches(&s.did, &reader.peer_did)).unwrap();
		assert_eq!(r.grant, "reads");
		assert_eq!(r.caps, vec!["read"]);
		let p = report.iter().find(|s| peer_did_matches(&s.did, &replica.peer_did)).unwrap();
		assert_eq!(p.grant, "replicate");
		assert_eq!(p.caps, vec!["replicate"]);
	}

	#[test]
	fn rebuild_excluding_revokes_one_admin_keeps_owner_and_rest() {
		// Alice (owner) grants Bob and Carol, then revokes Bob via re-mint.
		let alice = build_vault_from_root(&[1u8; 32]).unwrap();
		let bob = build_vault_from_root(&[2u8; 32]).unwrap();
		let carol = build_vault_from_root(&[3u8; 32]).unwrap();
		let sid = uuid::Uuid::new_v4();

		let mut chain = mint_genesis_spark(&alice, sid).unwrap();
		chain = attenuate_add_owner_third_party(&alice.biscuit_kp, &chain, sid, &bob.peer_did).unwrap();
		chain =
			attenuate_add_owner_third_party(&alice.biscuit_kp, &chain, sid, &carol.peer_did).unwrap();

		let mut v = alice;
		v.sparks.insert(sid, BiscuitSpark { spark_id: sid, biscuit: chain });

		// Sanity: all three authorized before revoke.
		authorize(&v, sid, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &bob.peer_did).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &carol.peer_did).unwrap();

		// Revoke Bob: re-mint excluding Bob.
		let rebuilt = rebuild_spark_biscuit_excluding(&v, sid, &bob.peer_did).unwrap();
		let admins = spark_admins(&rebuilt, sid).unwrap();
		assert!(admins.iter().any(|d| peer_did_matches(d, &v.peer_did)), "owner kept");
		assert!(admins.iter().any(|d| peer_did_matches(d, &carol.peer_did)), "carol kept");
		assert!(!admins.iter().any(|d| peer_did_matches(d, &bob.peer_did)), "bob removed");

		// Authorize against the rebuilt chain: owner + carol allowed, bob denied.
		v.sparks.insert(sid, BiscuitSpark { spark_id: sid, biscuit: rebuilt });
		authorize(&v, sid, AccOp::Write, "todos", None, &v.peer_did.clone()).unwrap();
		authorize(&v, sid, AccOp::Write, "todos", None, &carol.peer_did).unwrap();
		assert!(
			authorize(&v, sid, AccOp::Write, "todos", None, &bob.peer_did).is_err(),
			"revoked Bob must be denied on the rebuilt biscuit"
		);
	}
}
