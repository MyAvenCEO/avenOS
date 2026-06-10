#!/usr/bin/env python3
"""Stop hook: when a session's context crosses the rotation threshold, force an
automatic handoff — Claude writes state to memory/docs and tells the user to
start a fresh chat. Fires once per session (marker file in STATE_DIR)."""
import json
import os
import sys

THRESHOLD = int(os.environ.get("CTX_HANDOFF_THRESHOLD", "200000"))
STATE_DIR = os.path.expanduser("~/.claude/hooks/.ctx-handoff")


def latest_ctx(tp: str) -> int:
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
                return (
                    (u.get("input_tokens") or 0)
                    + (u.get("cache_read_input_tokens") or 0)
                    + (u.get("cache_creation_input_tokens") or 0)
                )
    except Exception:
        pass
    return 0


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    if data.get("stop_hook_active"):
        return
    sid = data.get("session_id") or ""
    tp = data.get("transcript_path") or ""
    if not sid or not tp:
        return
    ctx = latest_ctx(tp)
    if ctx < THRESHOLD:
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    marker = os.path.join(STATE_DIR, sid)
    if os.path.exists(marker):
        return
    with open(marker, "w") as f:
        f.write(str(ctx))
    k = ctx // 1000
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": (
                    f"AUTO-HANDOFF TRIGGER: this conversation's context just reached {k}k tokens, "
                    f"past the {THRESHOLD // 1000}k rotation threshold, so every further message here "
                    "is expensive. Before finishing this turn: (1) write or update the handoff for "
                    "this work — the auto-memory project file for this topic (plus its MEMORY.md "
                    "index line) and, if a natural project folder exists, a HANDOFF.md there — "
                    "covering current state, key decisions and why, open threads / next steps, and "
                    "relevant file paths. Never include secrets, tokens, account numbers, or PII. "
                    f"(2) Then tell the user plainly: context is at {k}k, the handoff is saved (list "
                    "the locations), and they should retire this chat and start a fresh one for "
                    "this topic — the new chat will auto-load memory and pick up where this left "
                    "off."
                ),
            }
        )
    )


if __name__ == "__main__":
    main()
