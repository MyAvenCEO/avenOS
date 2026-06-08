#!/usr/bin/env bash
# Idempotent setup for the video-edit skill.
# Installs Python deps and checks the Node/Hyperframes toolchain.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> video-edit setup ($SKILL_DIR)"

# 1. ffmpeg
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install via: brew install ffmpeg"
  exit 1
fi
echo "    ffmpeg: $(ffmpeg -version | head -n1)"

# 2. Python deps
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found"; exit 1
fi

VENV_DIR="$SKILL_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating venv at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python3 -m pip install --quiet --upgrade pip
# Python deps the helper scripts need (Pexels stock fetch, etc.).
if ! python3 -c "import requests" >/dev/null 2>&1; then
  echo "==> Installing python deps (requests)"
  python3 -m pip install --quiet "requests>=2.31.0"
fi
echo "    requests: $(python3 -c 'import requests; print(requests.__version__)')"

# 3. Node / Hyperframes toolchain
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node 22+."; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node >= 22 required (found $(node -v 2>/dev/null || echo none)). Hyperframes needs it."; exit 1
fi
# Hyperframes is run on demand via `npx hyperframes@latest …` — no global install,
# no node_modules dir. First render downloads a headless Chrome (~once).
echo "==> Checking Hyperframes (npx, on-demand)"
HF_VERSION="${HF_VERSION:-latest}"
echo "    Hyperframes: $(npx -y "hyperframes@${HF_VERSION}" --version 2>/dev/null || echo "(will fetch on first use)")"
# Word-level transcription ships with Hyperframes itself:
#   npx hyperframes transcribe <audio> --json   (model small.en)
# No WhisperX install — transcribe.py wraps the Hyperframes transcriber.

echo "==> setup OK"
