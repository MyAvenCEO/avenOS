fn main() {
	// `sherpa-onnx-sys` emits the C++ runtime + Foundation link directives only
	// for `target_os = "linux" | "macos"`; for iOS its build script falls through
	// to a no-op. Statically linking sherpa-onnx (+ onnxruntime) on iOS therefore
	// leaves libc++ and Foundation symbols unresolved at link time. Supply them
	// here, gated on the iOS target and the `local-voice` feature (which pulls in
	// the sherpa-onnx static libs). NOTE: build scripts compile for the HOST, so
	// `cfg!(target_os = ...)` would report macOS — read the real *target* from
	// CARGO_CFG_TARGET_OS instead.
	let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
	if target_os == "ios" && std::env::var_os("CARGO_FEATURE_LOCAL_VOICE").is_some() {
		println!("cargo:rustc-link-lib=c++");
		println!("cargo:rustc-link-lib=framework=Foundation");
	}

	tauri_build::build()
}
