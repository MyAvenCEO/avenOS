#!/usr/bin/env python3
"""Regenerate the Rust-loadable MOSS-TTS-Nano `tokenizer.json` from the upstream
sentencepiece `tokenizer.model`.

MOSS-TTS-Nano ships a *custom slow* `MossTTSNanoSentencePieceTokenizer` (plain
sentencepiece BPE, byte_fallback, vocab 16384) — there is no HF fast
`tokenizer.json`, and the Rust `tokenizers` crate cannot load a raw `.model`. This
script rebuilds an equivalent fast tokenizer and **verifies it reproduces the slow
tokenizer's ids exactly** on a multilingual plain-text corpus before saving.

The result is committed at `app/src-tauri/resources/moss-tts-nano/tokenizer.json`
and bundled into the app (the on-device TTS path loads it via the `tokenizers`
crate). Re-run this only if upstream changes the tokenizer.

Requires: `transformers`, `tokenizers`, `sentencepiece`, `protobuf`.
Usage:    python3 scripts/moss-tts-nano-tokenizer.py [out_path]

NOTE: parity holds for plain natural-language text (what the TTS path tokenizes).
The structural prompt tokens come pre-tokenized as ids from the model manifest, so
text embedded *with* special tokens is never re-encoded here. spm's
`remove_extra_whitespaces` (collapse-all-whitespace + strip) is replicated by the
normalizer below.
"""
import sys

from transformers import AutoTokenizer
from transformers.tokenization_utils_base import generate_merges
from sentencepiece import sentencepiece_model_pb2 as spm_pb2
from tokenizers import Tokenizer, AddedToken, decoders, normalizers, Regex
from tokenizers.models import BPE

REPO = "OpenMOSS-Team/MOSS-TTS-Nano"  # PyTorch repo carrying tokenizer.model + the slow class
ONNX_REPO = "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"  # ships the same tokenizer.model
OUT = sys.argv[1] if len(sys.argv) > 1 else "app/src-tauri/resources/moss-tts-nano/tokenizer.json"


def build(model_path: str) -> Tokenizer:
    proto = spm_pb2.ModelProto()
    proto.ParseFromString(open(model_path, "rb").read())
    assert proto.trainer_spec.model_type == 2, "expected a BPE sentencepiece model"

    vocab = {p.piece: i for i, p in enumerate(proto.pieces)}
    merges = generate_merges(vocab)
    tok = Tokenizer(BPE(vocab=vocab, merges=merges, unk_token="<unk>", fuse_unk=True, byte_fallback=True))
    # spm normalization: collapse all whitespace runs to one space, strip ends,
    # add the dummy prefix, then escape spaces to the ▁ metasymbol.
    tok.normalizer = normalizers.Sequence([
        normalizers.Replace(Regex(r"\s+"), " "),
        normalizers.Strip(left=True, right=True),
        normalizers.Prepend(prepend="▁"),
        normalizers.Replace(pattern=" ", content="▁"),
    ])
    tok.decoder = decoders.Sequence([
        decoders.Replace("▁", " "),
        decoders.ByteFallback(),
        decoders.Fuse(),
        decoders.Strip(content=" ", left=1, right=0),
    ])
    # Control tokens (type 3) + user-defined symbols (type 4) match atomically.
    specials = [(p.piece, p.type == 3) for p in proto.pieces if p.type in (3, 4)]
    tok.add_special_tokens([AddedToken(t, normalized=False, special=True) for t, sp in specials if sp])
    tok.add_tokens([AddedToken(t, normalized=False, special=False) for t, sp in specials if not sp])
    return tok


def verify(fast: Tokenizer, slow) -> bool:
    corpus = [
        "Hello, world!", "Welcome to the on-device demo.", "Guten Tag, wie geht es dir?",
        "123 numbers & symbols!", "  leading spaces", "trailing spaces   ", "\nNewlines\nhere\n",
        "tabs\tand\tspaces", "Tschüss! 日本語 mix", "The quick brown fox.", "Ça va? Très bien, merci.",
        "Numbers: 3.14159 and 42%.", "Cost: $1,234.56 (approx).", "Zeile eins.\nZeile zwei.",
        "emoji 🚀 and accents café naïve", "1) first 2) second 3) third", "Mixed CASE and pUncTuaTion?!",
    ]
    bad = 0
    for s in corpus:
        a = slow(s, add_special_tokens=False)["input_ids"]
        b = fast.encode(s).ids
        if a != b:
            bad += 1
            print(f"MISMATCH {s!r:40} slow{a[:16]} fast{b[:16]}")
    print(f"{len(corpus) - bad}/{len(corpus)} parity OK")
    return bad == 0


def main():
    from huggingface_hub import hf_hub_download
    model_path = hf_hub_download(ONNX_REPO, "tokenizer.model")
    slow = AutoTokenizer.from_pretrained(REPO, trust_remote_code=True)
    if not getattr(slow, "vocab_file", None):
        slow.vocab_file = model_path
    fast = build(model_path)
    if not verify(fast, slow):
        sys.exit("parity failed — refusing to write tokenizer.json")
    fast.save(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
