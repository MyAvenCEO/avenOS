#!/usr/bin/env python3
"""
Transcribe a video to word-level timestamps via Hyperframes' transcriber.
Output: <video>.workdir/words.json -> [{"word", "start", "end"}, ...]

Hyperframes ships its OWN word-level transcriber:
`npx hyperframes transcribe <audio> --json` (model small.en) which writes a
transcript.json — a flat array of {start, end, word}. We wrap that and apply
the SAME auto-correction logic the original used (Cloud→Claude, brand fixes).

Unlike the original WhisperX path, the Hyperframes transcriber has no heavy
Python deps (faster-whisper, pyannote, etc.), so there is no skill-venv
self-relaunch — it runs via `npx hyperframes@latest …` on Node, the same way
`render.sh` invokes the CLI. Node ≥ 22 and ffmpeg on PATH are the only
requirements.
"""
import json
import os
import sys
import subprocess
import tempfile
from pathlib import Path

# Hyperframes is run on demand via `npx hyperframes@<version> …` — no global
# install. Override with HF_VERSION (matches render.sh's convention).
_HF_VERSION = os.environ.get("HF_VERSION", "latest")


def workdir_for(video_path: Path) -> Path:
    """Workdir lives under ~/.cache/video-edit/<hash>/ so macOS TCC on Downloads/Documents
    can never lock our intermediates after a reboot."""
    import hashlib
    digest = hashlib.sha1(str(video_path.resolve()).encode()).hexdigest()[:12]
    base = Path.home() / ".cache" / "video-edit" / f"{video_path.stem[:40]}_{digest}"
    base.mkdir(parents=True, exist_ok=True)
    return base


def extract_audio(video_path: Path, audio_path: Path) -> None:
    # Invalidate cache when the source video is newer than the cached audio.
    # Prevents the "stale audio.wav vs replaced source" bug — every previous
    # transcription was working against an old video; all subsequent
    # speech-aligned beats were drifted by however much the new source
    # differed in length.
    if audio_path.exists() and audio_path.stat().st_mtime >= video_path.stat().st_mtime:
        return
    if audio_path.exists():
        print(f"[stale] source newer than audio.wav — re-extracting", flush=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video_path),
            "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(audio_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def transcribe(audio_path: Path, model_size: str = "small.en") -> list[dict]:
    # Hyperframes' transcriber emits a flat array of {start, end, word} as JSON.
    # `--json` prints the transcript to stdout; some CLI builds instead write a
    # transcript.json next to the audio. We handle both: prefer stdout, fall
    # back to the sidecar file. Model is small.en (Hyperframes' default).
    result = subprocess.run(
        [
            "npx", "-y", f"hyperframes@{_HF_VERSION}", "transcribe",
            str(audio_path), "--json", "--model", model_size,
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    raw = result.stdout.strip()
    transcript = None
    if raw:
        # Tolerate npx/CLI banner noise before the JSON payload: find the first
        # array/object bracket and parse from there.
        for start in (raw.find("["), raw.find("{")):
            if start == -1:
                continue
            try:
                transcript = json.loads(raw[start:])
                break
            except json.JSONDecodeError:
                continue
    if transcript is None:
        # Fall back to a sidecar transcript.json the CLI may have written.
        sidecar = audio_path.with_name("transcript.json")
        if not sidecar.exists():
            sidecar = audio_path.with_suffix(".json")
        if sidecar.exists():
            transcript = json.loads(sidecar.read_text())
    if transcript is None:
        raise RuntimeError("hyperframes transcribe produced no parseable JSON transcript")

    # Hyperframes returns a flat list of {start, end, word}. Some builds wrap it
    # as {"words": [...]} — accept both shapes.
    if isinstance(transcript, dict):
        transcript = transcript.get("words", [])

    words: list[dict] = []
    for w in transcript:
        if "start" in w and "end" in w and w.get("word"):
            words.append({
                "word": w["word"].strip(),
                "start": float(w["start"]),
                "end": float(w["end"]),
            })
    return _apply_corrections(_normalize_brand_terms(words))


# ---------------------------------------------------------------------------
# Phrase-level transcription corrections.
#
# The transcriber mishears predictably on this channel. `_normalize_brand_terms`
# handles single-word brand fixes (cloud→claude). This handles CONTEXTUAL
# mishearings — where the wrong word IS a real word and can only be fixed by
# the phrase around it. e.g. "caught their costs" is nonsense ("caught the
# wave" elsewhere is correct) — only the 3-word phrase disambiguates it.
#
# Each entry: (wrong_tokens, right_tokens), SAME length. Matching is
# lower-cased + punctuation-stripped; on a hit, each word's text is rewritten
# (capitalization + trailing punctuation of the original preserved).
#
# Add new mishearings here as they show up — it's the channel's correction
# memory. Transcription is never perfect; this is the deterministic patch.
PHRASE_CORRECTIONS: list[tuple[list[str], list[str]]] = [
    (["caught", "their", "costs"], ["cut", "their", "costs"]),
    # tool / brand names this channel says constantly that the transcriber garbles
    (["use", "creativity", "claude"], ["use", "ChatGPT", "Claude"]),
    (["clawed", "and", "lovable"], ["Claude", "and", "Lovable"]),
    # "Hermes Agent" — channel's own tool; the transcriber hears "Gemini agent".
    (["gemini", "agent"], ["Hermes", "Agent"]),
    # Number-word mishearings on this channel (the transcriber turns sharp /eɪt/
    # syllables into common words). Scene-2 May 23 2026: "other aid didn't"
    # should be "other eight didn't" (referring to 8 cancelled AI tools).
    (["other", "aid"], ["other", "eight"]),
    (["aid", "didn't"], ["eight", "didn't"]),
]

# Single-word brand fixes — same idea as cloud→claude, extended. Each maps a
# bare (lowercased, punctuation-stripped) mishearing to the correct word;
# capitalization + trailing punctuation of the original are preserved.
BRAND_WORDS: dict[str, str] = {
    "cloud": "claude",
    "ozemic": "ozempic",
    "ozampic": "ozempic",
    "ozempick": "ozempic",
    # "Bolt" (the app builder) — the transcriber hears "vault".
    "vault": "bolt",
}


def _apply_corrections(words: list[dict]) -> list[dict]:
    def bare(s: str) -> str:
        return s.lower().strip(".,!?;:'\"")

    spoken = [bare(w["word"]) for w in words]
    total = 0
    for wrong, right in PHRASE_CORRECTIONS:
        n = len(wrong)
        for i in range(len(spoken) - n + 1):
            if spoken[i:i + n] == wrong:
                for k in range(n):
                    if wrong[k] == right[k]:
                        continue
                    orig = words[i + k]["word"]
                    # carry leading capital + trailing punctuation across
                    lead_cap = bool(orig) and orig[0].isupper()
                    tail = ""
                    j = len(orig)
                    while j > 0 and orig[j - 1] in ".,!?;:'\"":
                        tail = orig[j - 1] + tail
                        j -= 1
                    new = right[k]
                    if lead_cap:
                        new = new[:1].upper() + new[1:]
                    words[i + k]["word"] = new + tail
                    spoken[i + k] = bare(new)
                    total += 1
    if total:
        print(f"[correct] applied {total} phrase-correction word(s)", flush=True)
    return words


def _normalize_brand_terms(words: list[dict]) -> list[dict]:
    """The transcriber consistently mishears 'Claude' as 'Cloud' on this channel.

    Since every video this skill processes is about Claude / Claude Code,
    we substitute deterministically before downstream tools read words.json.
    Keeps speech_anchor matching, list-item keyword matching, and any rendered
    captions consistent with what the speaker actually said.

    Logs the substitution count so a regression is visible in build output.
    """
    fixed = 0
    for w in words:
        original = w["word"]
        bare = original.lower().strip(".,!?;:'\"")
        repl = BRAND_WORDS.get(bare)
        if repl:
            # preserve leading-capital + trailing punctuation
            tail = ""
            j = len(original)
            while j > 0 and original[j - 1] in ".,!?;:'\"":
                tail = original[j - 1] + tail
                j -= 1
            new = repl[:1].upper() + repl[1:] if (original and original[0].isupper()) else repl
            w["word"] = new + tail
            fixed += 1
    if fixed:
        print(f"[brand] substituted {fixed} brand word(s)", flush=True)
    return words


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: transcribe.py <video_path> [model_size]", file=sys.stderr)
        return 2

    video_path = Path(sys.argv[1]).expanduser().resolve()
    if not video_path.exists():
        print(f"video not found: {video_path}", file=sys.stderr)
        return 1

    model_size = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("WHISPER_MODEL", "small.en")

    wd = workdir_for(video_path)
    wd.mkdir(exist_ok=True)
    words_json = wd / "words.json"

    # Invalidate words.json when source video is newer (re-uploaded).
    if (words_json.exists()
            and words_json.stat().st_mtime >= video_path.stat().st_mtime
            and os.environ.get("FORCE") != "1"):
        print(f"words.json exists and is fresh, skipping: {words_json}")
        return 0
    if words_json.exists():
        print(f"[stale] source newer than words.json — re-transcribing", flush=True)

    audio_path = wd / "audio.wav"
    print(f"[1/2] Extracting audio -> {audio_path}")
    extract_audio(video_path, audio_path)

    print(f"[2/2] Transcribing with Hyperframes (model={model_size})")
    words = transcribe(audio_path, model_size)
    words_json.write_text(json.dumps(words, indent=2))
    print(f"Wrote {len(words)} words -> {words_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
