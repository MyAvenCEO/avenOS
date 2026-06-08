//! CLI: word-level speech-to-text with our own on-device STT (Parakeet via
//! sherpa-onnx) — the SAME engine the app ships (`aven_ai::stt`), driven from
//! the command line so the video-edit skill can align captions without the app
//! and without Whisper.
//!
//! Usage:
//!   cargo run --release --example asr_transcribe --features stt -- <in.wav> [out.json]
//!
//!   <in.wav>   mono WAV (any sample rate; 16 kHz mono recommended — sherpa
//!              resamples internally). The video-edit `transcribe.py` feeds a
//!              16 kHz mono wav produced with ffmpeg.
//!   [out.json] where to write the transcript (default: stdout). Format is a flat
//!              array of {start,end,word} (seconds) — the same shape Hyperframes'
//!              transcript.json uses, so it's a drop-in for caption alignment.
//!
//! Env:
//!   AVENOS_MODELS_DIR   models root (default: ~/Documents/.avenOS/models — the
//!                       app's models dir, so the Parakeet model the app already
//!                       downloaded is reused; nothing re-downloads).

use std::path::{Path, PathBuf};
use std::time::Instant;

use aven_ai::stt::{self, ModelSpec, Transcriber};

// Parakeet TDT 0.6b v3 int8 — identical to the app's asr.rs spec, so they share
// the on-disk model under <models>/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/.
const MODEL_DIR: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";

fn spec() -> ModelSpec {
    ModelSpec {
        dir: MODEL_DIR,
        url: MODEL_URL,
        encoder: "encoder.int8.onnx",
        decoder: "decoder.int8.onnx",
        joiner: "joiner.int8.onnx",
        tokens: "tokens.txt",
    }
}

/// Same resolution as the app (`tauri_plugin_self::paths::models_dir`):
/// `<Documents>/.avenOS/models`, overridable with `AVENOS_MODELS_DIR`.
fn models_root() -> PathBuf {
    if let Ok(p) = std::env::var("AVENOS_MODELS_DIR") {
        return PathBuf::from(p);
    }
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join("Documents/.avenOS/models")
}

fn die(msg: impl AsRef<str>) -> ! {
    eprintln!("[asr_transcribe] {}", msg.as_ref());
    std::process::exit(1);
}

/// Read a mono WAV into f32 PCM + its sample rate (i16 or f32 samples; first
/// channel only if stereo slips through).
fn read_wav(path: &Path) -> (Vec<f32>, u32) {
    let mut r = hound::WavReader::open(path)
        .unwrap_or_else(|e| die(format!("open {}: {e}", path.display())));
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().filter_map(Result::ok).collect(),
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().filter_map(Result::ok).map(|s| s as f32 / max).collect()
        }
    };
    let mono: Vec<f32> = if ch <= 1 { samples } else { samples.iter().step_by(ch).copied().collect() };
    (mono, spec.sample_rate)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(input) = args.next() else {
        die("usage: asr_transcribe <in.wav> [out.json]");
    };
    let out = args.next();

    let root = models_root();
    let spec = spec();
    if !spec.files_present(&root) {
        eprintln!(
            "[asr_transcribe] Parakeet model not found under {} — downloading (first run only)…",
            spec.model_dir(&root).display()
        );
        stt::download_and_extract(&spec, &root, || false, |recv, total| {
            if total > 0 {
                eprint!("\r[asr_transcribe] {:>3}%  ", recv * 100 / total);
            }
        })
        .unwrap_or_else(|e| die(format!("model download failed: {e}")));
        eprintln!();
    }

    let (pcm, sr) = read_wav(Path::new(&input));
    eprintln!("[asr_transcribe] loading Parakeet from {}…", spec.model_dir(&root).display());
    let t = Instant::now();
    let asr = Transcriber::load(&spec, &root).unwrap_or_else(|e| die(e));
    eprintln!(
        "[asr_transcribe] loaded in {:.1}s; transcribing {:.1}s of audio ({} Hz)…",
        t.elapsed().as_secs_f64(),
        pcm.len() as f64 / sr as f64,
        sr
    );

    let t = Instant::now();
    let (text, words) = asr.transcribe_words(&pcm, sr);
    eprintln!(
        "[asr_transcribe] {} words in {:.1}s",
        words.len(),
        t.elapsed().as_secs_f64()
    );

    // flat [{start,end,word}] JSON — matches Hyperframes transcript.json
    let mut json = String::from("[\n");
    for (i, w) in words.iter().enumerate() {
        let esc = w.text.replace('\\', "\\\\").replace('"', "\\\"");
        json.push_str(&format!(
            "  {{\"start\": {:.3}, \"end\": {:.3}, \"word\": \"{}\"}}{}\n",
            w.start, w.end, esc,
            if i + 1 < words.len() { "," } else { "" }
        ));
    }
    json.push_str("]\n");

    match out {
        Some(p) => {
            std::fs::write(&p, &json).unwrap_or_else(|e| die(format!("write {p}: {e}")));
            eprintln!("[asr_transcribe] text: {text}");
            println!("{p}");
        }
        None => print!("{json}"),
    }
}
