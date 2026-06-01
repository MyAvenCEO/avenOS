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
}

impl AccOp {
	fn as_op_str(self) -> &'static str {
		match self {
			AccOp::Read => "read",
			AccOp::Write => "write",
			AccOp::Delete => "delete",
		}
	}
}

fn spark_urn_for(spark_id: Uuid) -> String {
	format!("spark:{spark_id}")
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

	for op in ["read", "write", "delete", "admit", "rotate_dek"] {
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

	let admins = trusted_subject_dids(&chain.biscuit, &spark_str)?;
	if !admins.iter().any(|a| peer_did_matches(a, subject_did)) {
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
