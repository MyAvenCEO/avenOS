#!/usr/bin/env bash
#
# render.sh — render a Hyperframes composition to mp4 and publish it to the
# avenSKILLS "Editing" tab.
#
# Usage:
#   render.sh <project_dir> [id] [title]
#
#   project_dir  A Hyperframes project directory (contains index.html +
#                hyperframes.json). The default entry index.html is rendered.
#   id           Output slug (default: basename of project_dir). Produces
#                <id>.mp4 / <id>.html in the app's static dir.
#   title        Human title for the manifest (default: id).
#
# What it does:
#   1. Renders <project_dir>/index.html via `npx hyperframes render` → mp4
#   2. Copies the source index.html next to the mp4 (for "view source")
#   3. Upserts an entry into manifest.json (idempotent by id), pulling the
#      screenplay text from <project_dir>/script.md when present.
#
# Output lands in:  app/static/skills/editing/  (served at /skills/editing/...)
#
# Requirements: Node >= 22 and ffmpeg on PATH. No Remotion, no external SFX —
# rendering is fully local (headless Chrome + ffmpeg). Optional stock b-roll is
# fetched separately via fetch_stock.py (Pexels) before rendering.

set -euo pipefail

HF_VERSION="${HF_VERSION:-latest}"

err() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; }
info() { printf '\033[36m›\033[0m %s\n' "$*"; }

# --- args -------------------------------------------------------------------
PROJECT_DIR="${1:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  err "missing <project_dir>. Usage: render.sh <project_dir> [id] [title]"
  exit 2
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || { err "no such directory: ${1}"; exit 2; }
if [[ ! -f "$PROJECT_DIR/index.html" ]]; then
  err "no index.html in $PROJECT_DIR (not a Hyperframes project?)"
  exit 2
fi

ID="${2:-$(basename "$PROJECT_DIR")}"
TITLE="${3:-$ID}"

# --- preconditions ----------------------------------------------------------
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( NODE_MAJOR < 22 )); then
  err "Node >= 22 required (found $(node -v 2>/dev/null || echo none)). Hyperframes needs it."
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  err "ffmpeg not found on PATH. Install it (macOS: 'brew install ffmpeg')."
  exit 1
fi

# --- locate repo + static dir ----------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  # fallback: .claude/skills/video-edit/scripts -> up 4
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi
STATIC_DIR="$REPO_ROOT/app/static/skills/editing"
mkdir -p "$STATIC_DIR"

OUT_MP4="$STATIC_DIR/$ID.mp4"
OUT_HTML="$STATIC_DIR/$ID.html"
MANIFEST="$STATIC_DIR/manifest.json"

# --- render -----------------------------------------------------------------
info "Rendering $PROJECT_DIR → $OUT_MP4"
npx -y "hyperframes@${HF_VERSION}" render "$PROJECT_DIR" -o "$OUT_MP4" --quiet

[[ -f "$OUT_MP4" ]] || { err "render produced no file at $OUT_MP4"; exit 1; }
cp "$PROJECT_DIR/index.html" "$OUT_HTML"

# --- manifest upsert (python3) ---------------------------------------------
SCRIPT_MD=""
[[ -f "$PROJECT_DIR/script.md" ]] && SCRIPT_MD="$PROJECT_DIR/script.md"

info "Upserting manifest entry '$ID'"
ID="$ID" TITLE="$TITLE" SRC="/skills/editing/$ID.mp4" HTML="/skills/editing/$ID.html" \
MANIFEST="$MANIFEST" MP4="$OUT_MP4" SCRIPT_MD="$SCRIPT_MD" \
python3 - <<'PY'
import json, os, subprocess

manifest = os.environ["MANIFEST"]
entry_id = os.environ["ID"]

try:
    with open(manifest) as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        rows = []
except (FileNotFoundError, json.JSONDecodeError):
    rows = []

# duration via ffprobe (best-effort)
duration = None
try:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", os.environ["MP4"]],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    duration = round(float(out), 2)
except Exception:
    pass

script_text = ""
sm = os.environ.get("SCRIPT_MD") or ""
if sm and os.path.exists(sm):
    with open(sm) as f:
        script_text = f.read()

entry = {
    "id": entry_id,
    "title": os.environ["TITLE"],
    "src": os.environ["SRC"],
    "html": os.environ["HTML"],
    "script": script_text,
    "durationSec": duration,
}

rows = [r for r in rows if r.get("id") != entry_id]
rows.append(entry)
rows.sort(key=lambda r: r.get("id", ""))

with open(manifest, "w") as f:
    json.dump(rows, f, indent=2)
    f.write("\n")
print(f"manifest now lists {len(rows)} clip(s)")
PY

info "Done. Open avenSKILLS → Editing to play '$TITLE'."
