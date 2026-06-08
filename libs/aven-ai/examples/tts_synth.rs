//! CLI: synthesize a line of text to a WAV file with MOSS-TTS-Nano.
//!
//! Reuses the exact on-device TTS engine the app ships (`aven_ai::tts`) — same
//! ONNX graphs, same fixed "Bella" voice — but driven from the command line so
//! the video-edit skill can generate voiceover without the running app.
//!
//! Usage:
//!   cargo run --release --example tts_synth --features tts -- "Text to speak" out.wav
//!
//! Env:
//!   AVENOS_ORT_DYLIB    path to libonnxruntime.dylib
//!                       (default: <repo>/app/src-tauri/onnxruntime/libonnxruntime.dylib;
//!                        provision with `bun scripts/fetch-onnxruntime.ts`)
//!   AVENOS_MODELS_DIR   models root (default: ~/.avenOS/models). MOSS ONNX files
//!                       download here on first run (~hundreds of MB, once).

use std::path::{Path, PathBuf};
use std::time::Instant;

use aven_ai::tts::{self, SynthOptions, Synthesizer, TtsModelSpec};

const MODEL_DIR: &str = "moss-tts-nano-onnx";
const BASE_URL: &str = "https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX/resolve/main/";
const FILES: &[(&str, &str)] = &[
    ("moss_tts_prefill.onnx", "moss_tts_prefill.onnx"),
    ("moss_tts_decode_step.onnx", "moss_tts_decode_step.onnx"),
    ("moss_tts_local_fixed_sampled_frame.onnx", "moss_tts_local_fixed_sampled_frame.onnx"),
    ("moss_tts_global_shared.data", "moss_tts_global_shared.data"),
    ("moss_tts_local_shared.data", "moss_tts_local_shared.data"),
    ("browser_poc_manifest.json", "browser_poc_manifest.json"),
];
const CODEC_BASE_URL: &str =
    "https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX/resolve/main/";
const CODEC_FILES: &[(&str, &str)] = &[
    ("moss_audio_tokenizer_decode_full.onnx", "moss_audio_tokenizer_decode_full.onnx"),
    ("moss_audio_tokenizer_decode_shared.data", "moss_audio_tokenizer_decode_shared.data"),
];

fn spec() -> TtsModelSpec {
    TtsModelSpec {
        dir: MODEL_DIR,
        base_url: BASE_URL,
        files: FILES,
        codec_base_url: CODEC_BASE_URL,
        codec_files: CODEC_FILES,
        prefill: "moss_tts_prefill.onnx",
        decode_step: "moss_tts_decode_step.onnx",
        local_frame: "moss_tts_local_fixed_sampled_frame.onnx",
        codec_decode: "moss_audio_tokenizer_decode_full.onnx",
        manifest: "browser_poc_manifest.json",
        tokenizer: "tokenizer.json",
    }
}

fn repo_root() -> PathBuf {
    // examples run from the crate dir (libs/aven-ai) -> up 2 = repo root.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

fn resolve_dylib() -> PathBuf {
    if let Ok(p) = std::env::var("AVENOS_ORT_DYLIB") {
        return PathBuf::from(p);
    }
    repo_root().join("app/src-tauri/onnxruntime/libonnxruntime.dylib")
}

fn models_root() -> PathBuf {
    if let Ok(p) = std::env::var("AVENOS_MODELS_DIR") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join(".avenOS/models")
}

fn die(msg: impl AsRef<str>) -> ! {
    eprintln!("[tts_synth] {}", msg.as_ref());
    std::process::exit(1);
}

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(text), Some(out)) = (args.next(), args.next()) else {
        die("usage: tts_synth \"<text>\" <out.wav>");
    };
    let out = PathBuf::from(out);

    // 1) onnxruntime
    let dylib = resolve_dylib();
    if !dylib.is_file() {
        die(format!(
            "onnxruntime dylib not found at {}. Run `bun scripts/fetch-onnxruntime.ts` \
             or set AVENOS_ORT_DYLIB.",
            dylib.display()
        ));
    }
    tts::init_runtime(&dylib).unwrap_or_else(|e| die(e));

    // 2) models root + bundled tokenizer placed into the model dir
    let root = models_root();
    let spec = spec();
    let model_dir = spec.model_dir(&root);
    std::fs::create_dir_all(&model_dir).ok();
    place_tokenizer(&model_dir);

    // 3) download MOSS ONNX on first run
    if !spec.files_present(&root) {
        eprintln!("[tts_synth] downloading MOSS-TTS-Nano models → {} (first run only)…", model_dir.display());
        tts::download_files(&spec, &root, || false, |recv, total| {
            if total > 0 {
                eprint!("\r[tts_synth] {:>3}%  ", recv * 100 / total);
            }
        })
        .unwrap_or_else(|e| die(format!("model download failed: {e:?}")));
        eprintln!();
    }

    // 4) load + synthesize
    eprintln!("[tts_synth] loading synthesizer…");
    let t = Instant::now();
    let synth = Synthesizer::load(&spec, &root).unwrap_or_else(|e| die(e));
    let sample_rate = synth.sample_rate();
    eprintln!("[tts_synth] loaded in {:.1}s; synthesizing {} chars…", t.elapsed().as_secs_f64(), text.len());

    let mut pcm: Vec<f32> = Vec::new();
    let t = Instant::now();
    synth
        .synthesize(
            &text,
            SynthOptions { voice: Some("Bella".to_string()), ..Default::default() },
            |chunk| pcm.extend_from_slice(chunk),
            || false,
        )
        .unwrap_or_else(|e| die(e));

    if pcm.is_empty() {
        die("synthesis produced no audio");
    }
    let secs = pcm.len() as f64 / sample_rate as f64;
    eprintln!(
        "[tts_synth] {} samples @ {} Hz = {:.2}s (synth {:.1}s)",
        pcm.len(), sample_rate, secs, t.elapsed().as_secs_f64()
    );

    // 5) write a 16-bit mono WAV
    write_wav(&out, &pcm, sample_rate).unwrap_or_else(|e| die(e));
    println!("{}", out.display());
}

/// Copy the app's bundled, verified fast tokenizer into the model dir (the engine
/// expects `tokenizer.json` next to the ONNX files).
fn place_tokenizer(model_dir: &Path) {
    let dst = model_dir.join("tokenizer.json");
    if dst.is_file() {
        return;
    }
    let src = repo_root().join("app/src-tauri/resources/moss-tts-nano/tokenizer.json");
    if !src.is_file() {
        die(format!("bundled tokenizer not found at {}", src.display()));
    }
    std::fs::copy(&src, &dst).unwrap_or_else(|e| die(format!("copy tokenizer: {e}")));
}

fn write_wav(path: &Path, pcm: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| format!("wav create: {e}"))?;
    for &s in pcm {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        w.write_sample(v).map_err(|e| format!("wav write: {e}"))?;
    }
    w.finalize().map_err(|e| format!("wav finalize: {e}"))?;
    Ok(())
}
