//! Spike: load an LFM2.5-8B-A1B GGUF via llama.cpp (Metal) and measure decode tok/s.
//!
//! Usage:
//!   cargo run --release --example llama_spike --features llama -- <model.gguf> ["prompt"]

use std::path::PathBuf;
use std::time::Instant;

fn main() {
	let mut args = std::env::args().skip(1);
	let Some(model) = args.next().map(PathBuf::from) else {
		eprintln!("usage: llama_spike <model.gguf> [\"prompt\"]");
		std::process::exit(2);
	};
	let prompt = args
		.next()
		.unwrap_or_else(|| "Explain what a self-sovereign identity is, in one sentence.".to_string());

	eprintln!("[spike] loading {} (Metal — all layers on GPU)…", model.display());
	let t = Instant::now();
	match aven_ai::llama::generate(&model, &prompt, 64) {
		Ok(s) => {
			eprintln!("[spike] load + generate in {:.1}s", t.elapsed().as_secs_f64());
			println!("--- output ---\n{}\n--------------", s.text);
			println!("[spike] {} tokens @ {:.1} tok/s", s.tokens, s.tokens_per_sec);
		}
		Err(e) => {
			eprintln!("[spike] ERROR: {e}");
			std::process::exit(1);
		}
	}
}
