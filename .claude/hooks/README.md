# Token Spend Toolkit

Wired-up version of the [Claude Code Token Spend Toolkit](https://gist.github.com/cprkrn/d3f128a8e8e3ddfa4b38934edff34d42).
The core insight: a chat transcript is the most expensive storage you own — a file is free.
These tools surface context growth and auto-trigger a handoff before a chat gets expensive.

## What's auto-applied (via `.claude/settings.json`)

- **`statusline-context.py`** — `statusLine` provider. Live context meter in the status line:
  green `<100k`, yellow `100–200k` (compact soon), red `>=200k` (compact or clear),
  plus a `~$/msg` estimate based on model-family cache-read rates.
- **`context-rotation-hook.py`** — `Stop` hook. Fires **once per session** when context
  crosses the rotation threshold (default **200k**). It blocks the turn and instructs
  Claude to write a handoff (memory file + `MEMORY.md` index line, plus `HANDOFF.md` if a
  project folder fits) before telling you to retire the chat and start fresh.
  Tune with the `CTX_HANDOFF_THRESHOLD` env var (token count).

## Run on demand

- **`analyze_claude_usage.py`** — audits `~/.claude/projects/**/*.jsonl` locally and prints
  weekly/daily burn, model mix, per-project spend, top sessions, context-size percentiles,
  and the hottest 5-hour windows. No dependencies:

  ```sh
  python3 .claude/hooks/analyze_claude_usage.py
  ```

All scripts read only local transcripts and emit no network traffic.
