//! Spike: load an LFM2.5-1.2B GGUF via llama.cpp (Metal) and measure decode tok/s.
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
	let engine = aven_ai::llama::LlamaEngine::load(&model).unwrap_or_else(|e| {
		eprintln!("[spike] load ERROR: {e}");
		std::process::exit(1);
	});
	eprintln!("[spike] loaded in {:.1}s; generating…", t.elapsed().as_secs_f64());
	match engine.generate(&prompt, 64, |p| print!("{p}"), || false) {
		Ok(s) => println!("\n[spike] {} tokens @ {:.1} tok/s", s.tokens, s.tokens_per_sec),
		Err(e) => {
			eprintln!("[spike] ERROR: {e}");
			std::process::exit(1);
		}
	}
}
