//! Print the 32-byte hex avenDB SchemaHash for an aven-schema manifest JSON file.
use std::env;
use std::path::PathBuf;

use avenos_schema_hash::load_schema;
use aven_db::query_manager::types::SchemaHash;

fn hash_hex(bytes: &[u8; 32]) -> String {
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
	let path = env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| {
		eprintln!("usage: avenos-schema-hash <path-to.manifest.json>");
		std::process::exit(2);
	});
	match load_schema(&path) {
		Ok(schema) => {
			let hash = *SchemaHash::compute(&schema).as_bytes();
			println!("{}", hash_hex(&hash));
		}
		Err(e) => {
			eprintln!("{e}");
			std::process::exit(1);
		}
	}
}
