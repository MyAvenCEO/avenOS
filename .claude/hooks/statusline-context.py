#!/usr/bin/env python3
"""Claude Code status line: live context size with cost warning colors.
Reads the harness JSON from stdin, tails the session transcript, and reports
the context size (input + cache read + cache write) of the latest API call.
Green <100k, yellow 100-200k (compact soon), red >=200k (compact or clear).
"""
import json
import sys

GREEN, YELLOW, RED, DIM, RESET = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"
# cache-read $/token by model family (the dominant per-message cost driver)
RATES = {"haiku": 0.10e-6, "sonnet": 0.30e-6, "opus": 0.50e-6, "fable": 1.00e-6}


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        print("ctx ?")
        return
    model = (data.get("model") or {}).get("display_name") or ""
    tp = data.get("transcript_path") or ""
    ctx = 0
    try:
        with open(tp, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 250_000))
            chunk = f.read().decode("utf-8", "replace")
            for line in reversed(chunk.splitlines()):
                if '"usage"' not in line:
                    continue
                try:
                    j = json.loads(line)
                except Exception:
                    continue
                if j.get("type") != "assistant":
                    continue
                u = (j.get("message") or {}).get("usage") or {}
                ctx = (
                    (u.get("input_tokens") or 0)
                    + (u.get("cache_read_input_tokens") or 0)
                    + (u.get("cache_creation_input_tokens") or 0)
                )
                break
    except Exception:
        pass
    if ctx == 0:
        print(f"{model} {DIM}| ctx: fresh{RESET}".strip())
        return
    k = ctx / 1000.0
    rate = 0.50e-6
    for fam, r in RATES.items():
        if fam in model.lower():
            rate = r
            break
    permsg = ctx * rate
    if k < 100:
        meter = f"{GREEN}ctx {k:.0f}k{RESET}"
    elif k < 200:
        meter = f"{YELLOW}ctx {k:.0f}k ⚠ /compact soon{RESET}"
    else:
        meter = f"{RED}ctx {k:.0f}k 🔥 /compact or /clear{RESET}"
    print(f"{model} | {meter} | ~${permsg:.2f}/msg")


if __name__ == "__main__":
    main()
