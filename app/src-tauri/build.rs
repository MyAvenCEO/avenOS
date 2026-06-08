use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

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

	// iOS + llama.cpp link fix. For a `staticlib`, cargo BUNDLES native static libs into the
	// final `libapp.a` by object *basename*, and the llama-cpp-sys-2 archives carry colliding
	// basenames BOTH within a lib (ggml-cpu's `quants.c.o`/`repack.cpp.o` — generic + arch/arm)
	// AND across libs (`llama.cpp.o` in libllama + libcommon). The bundle clobbers one of each,
	// dropping the ggml-cpu definitions (`ggml_compute_forward_*`) → "undefined symbols for
	// architecture arm64" at the xcodebuild link. macOS links the `.a`s directly (no bundling)
	// so it's unaffected. Fix: after llama-cpp-sys-2 built the archives (dep order) and BEFORE
	// our staticlib link, rewrite every member name to be GLOBALLY unique across all the llama
	// archives, then `ranlib` to rebuild each index.
	if target_os == "ios" && std::env::var_os("CARGO_FEATURE_LOCAL_LLAMA").is_some() {
		// ggml's CPU backend is built with GGML_USE_ACCELERATE on Apple, so its ops
		// reference Accelerate's vDSP_* symbols (`ggml_compute_forward_*` → `_vDSP_vadd`,
		// `_vDSP_vmul`, …). On macOS Tauri links the `.a`s via cargo, which picks up
		// llama-cpp-sys-2's Accelerate link directive; the iOS path links through
		// xcodebuild against `libapp.a`, where that directive is lost — only Metal/MetalKit
		// made it into the generated Xcode project. Supply Accelerate here the same way the
		// Foundation fix above does (Tauri's `ios xcode-script` forwards cargo link output),
		// or the archive fails with "Undefined symbols … _vDSP_* … for architecture arm64".
		println!("cargo:rustc-link-lib=framework=Accelerate");
		uniquify_llama_archives();
	}

	tauri_build::build()
}

/// Make every member name unique across ALL llama-cpp-sys-2 static archives so cargo's
/// basename-keyed staticlib bundling can't drop any object. Best-effort: warns, never panics.
fn uniquify_llama_archives() {
	let Ok(out_dir) = std::env::var("OUT_DIR") else { return };
	// OUT_DIR = .../target/<triple>/<profile>/build/aven-os-app-<hash>/out → up 2 → .../build/
	let Some(build_dir) = Path::new(&out_dir).ancestors().nth(2) else { return };
	println!("cargo:warning=[ios-llama-link] scanning {}", build_dir.display());

	let mut libs: Vec<PathBuf> = Vec::new();
	if let Ok(entries) = std::fs::read_dir(build_dir) {
		for entry in entries.flatten() {
			if !entry.file_name().to_string_lossy().starts_with("llama-cpp-sys-2-") {
				continue;
			}
			let lib_dir = entry.path().join("out").join("lib");
			if let Ok(rd) = std::fs::read_dir(&lib_dir) {
				for f in rd.flatten() {
					let p = f.path();
					if p.extension().map(|e| e == "a").unwrap_or(false) {
						libs.push(p);
					}
				}
			}
		}
	}
	println!("cargo:warning=[ios-llama-link] {} llama archives found", libs.len());

	// One shared name registry across all archives → cross-lib uniqueness too.
	let mut seen: HashMap<String, usize> = HashMap::new();
	for lib in &libs {
		println!("cargo:rerun-if-changed={}", lib.display());
		match make_archive_unique(lib, &mut seen) {
			Ok(renamed) => {
				let name = lib.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
				println!("cargo:warning=[ios-llama-link] {name}: {renamed} members renamed");
			}
			Err(e) => println!("cargo:warning=[ios-llama-link] {} FAILED: {e}", lib.display()),
		}
	}
}

/// Rewrite `path` so every member name is unique vs `seen` (shared across archives). Returns
/// how many members were renamed. Skips the symbol/string table (`ranlib` rebuilds it).
fn make_archive_unique(path: &Path, seen: &mut HashMap<String, usize>) -> std::io::Result<usize> {
	let bytes = std::fs::read(path)?;
	let mut archive = ar::Archive::new(std::io::Cursor::new(&bytes));
	let mut members: Vec<(String, Vec<u8>)> = Vec::new();
	let mut renamed = 0usize;

	while let Some(entry) = archive.next_entry() {
		let mut entry = entry?;
		let id = String::from_utf8_lossy(entry.header().identifier()).into_owned();
		if id.starts_with("__.SYMDEF") || id == "/" || id == "//" {
			continue; // archive index / string table — ranlib regenerates
		}
		let mut data = Vec::new();
		entry.read_to_end(&mut data)?;
		let count = seen.entry(id.clone()).or_insert(0);
		*count += 1;
		let unique = if *count == 1 {
			id
		} else {
			renamed += 1;
			let n = *count;
			match id.strip_suffix(".o") {
				Some(stem) => format!("{stem}.{n}.o"),
				None => format!("{id}.{n}"),
			}
		};
		members.push((unique, data));
	}

	if renamed == 0 {
		return Ok(0); // nothing collided in this archive (idempotent)
	}

	let tmp = path.with_extension("a.dedup");
	{
		let mut builder = ar::Builder::new(std::fs::File::create(&tmp)?);
		for (name, data) in &members {
			let header = ar::Header::new(name.clone().into_bytes(), data.len() as u64);
			builder.append(&header, &data[..])?;
		}
	}
	std::fs::rename(&tmp, path)?;
	let status = std::process::Command::new("ranlib").arg(path).status();
	if !matches!(status, Ok(s) if s.success()) {
		println!("cargo:warning=[ios-llama-link] ranlib failed on {}", path.display());
	}
	Ok(renamed)
}
