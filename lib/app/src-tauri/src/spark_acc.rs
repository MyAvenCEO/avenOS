//! Offline capability gates (biscuit) for spark-scoped IPC.

use std::collections::HashSet;

use biscuit_auth::{
	builder::{Algorithm, AuthorizerBuilder},
	Biscuit,
	KeyPair, PublicKey,
};
use groove::query_manager::types::Value;

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

pub fn ingest_genesis_row(
	vault: &mut BiscuitVault,
	spark_id_col: usize,
	genesis_ix: usize,
	vals: &[Value],
	root: PublicKey,
) -> Result<(), String> {
	let sid_cell = vals.get(spark_id_col).ok_or("spark_missing_col")?;
	let spark_id =
		uuid_cell(sid_cell).ok_or_else(|| format!("spark_id_bad_cell:{sid_cell:?}"))?;
	let genesis_cell = vals.get(genesis_ix).ok_or("genesis_missing_col")?;
	let genesis_b64 = text_cell(genesis_cell).ok_or_else(|| format!("genesis_bad:{genesis_cell:?}"))?;

	let biscuit = biscuit_from_storage(genesis_b64, root)?;

	vault.sparks.insert(
		spark_id,
		BiscuitSpark {
			spark_id,
			biscuit,
		},
	);
	Ok(())
}

fn uuid_cell(v: &Value) -> Option<Uuid> {
	match v {
		Value::Uuid(oid) => Some(*oid.uuid()),
		Value::Text(s) => Uuid::parse_str(s.trim()).ok(),
		_ => None,
	}
}

fn text_cell(v: &Value) -> Option<&str> {
	match v {
		Value::Text(s) => Some(s.as_str()),
		_ => None,
	}
}

pub fn biscuit_from_storage(genesis_b64: &str, root: PublicKey) -> Result<Biscuit, String> {
	use base64::Engine;
	let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
		.decode(genesis_b64.as_bytes())
		.or_else(|_| {
			base64::engine::general_purpose::STANDARD_NO_PAD.decode(genesis_b64.as_bytes())
		})
		.map_err(|e| format!("genesis-base64:{e}"))?;

	Biscuit::from(raw.as_slice(), root).map_err(|e| format!("biscuit-from:{e}"))
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
	if !admins.contains(subject_did) {
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
}
