fn main() {
	// Card 0121 removed everything this script used to work around: the Google
	// OAuth creds baked in via `option_env!`, the sherpa-onnx iOS link directives,
	// and the llama.cpp static-archive dedupe (cargo bundles native libs into
	// `libapp.a` by object basename, and ggml's archives carried colliding ones).
	// With no native AI dependencies left there is nothing to patch — just build
	// the Tauri context.
	tauri_build::build()
}
