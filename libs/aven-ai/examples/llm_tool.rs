//! Smoke-test LFM2 tool calling against a local GGUF — verifies the model actually emits a
//! `navigate_pages` tool call (not prose) given the tool list.
//!
//!   cargo run --example llm_tool --features llama -- <model.gguf> ["prompt" ...]

use aven_ai::llama::{LlamaEngine, ToolSpec};

fn main() {
	let mut args = std::env::args().skip(1);
	let model = args.next().expect("usage: llm_tool <model.gguf> [prompt ...]");
	let prompts: Vec<String> = {
		let rest: Vec<String> = args.collect();
		if rest.is_empty() {
			vec![
				"Zeig mir die Settings.".into(),
				"gehe zu intents".into(),
				"öffne die lokalen Modelle".into(),
				"Wie spät ist es?".into(),
			]
		} else {
			rest
		}
	};

	let engine = LlamaEngine::load(std::path::Path::new(&model)).expect("load model");

	let tools = vec![ToolSpec {
		name: "navigate_pages".into(),
		description: "Navigate the app to one of its main pages. Call this whenever the user asks \
			to open, go to, show, or switch to a section of the app."
			.into(),
		parameters: serde_json::json!({
			"type": "object",
			"properties": {
				"route": {
					"type": "string",
					"enum": ["intents", "sandbox", "identities", "avens", "settings", "models", "network"],
					"description": "Which page to open."
				}
			},
			"required": ["route"]
		}),
	}];

	for p in &prompts {
		print!("\n=== prompt: {p:?}\n");
		let stats = engine
			.generate_with_tools(p, &tools, 256, |_piece| {}, || false)
			.expect("generate");
		println!("text   : {:?}", stats.text);
		if stats.tool_calls.is_empty() {
			println!("tool   : <none>");
		} else {
			for c in &stats.tool_calls {
				println!("tool   : {}({})", c.name, c.arguments);
			}
		}
	}
}
