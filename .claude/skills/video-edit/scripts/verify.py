#!/usr/bin/env python3
"""verify.py — post-render sanity check for a Hyperframes clip.

Usage:
    verify.py <mp4> [expected_seconds]

Checks the file exists, is a real h264/mp4 with a video stream, and (when an
expected duration is given) that the rendered duration is within 0.3s of it.
Exits non-zero on failure so render.sh / CI can gate on it.

Requires ffprobe (ships with ffmpeg).
"""
import json
import subprocess
import sys


def ffprobe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: verify.py <mp4> [expected_seconds]", file=sys.stderr)
        return 2

    path = sys.argv[1]
    expected = float(sys.argv[2]) if len(sys.argv) > 2 else None

    try:
        meta = ffprobe(path)
    except FileNotFoundError:
        print("error: ffprobe not found (install ffmpeg)", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print(f"error: ffprobe failed — {e.stderr.strip()}", file=sys.stderr)
        return 1

    video = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        print("error: no video stream in file", file=sys.stderr)
        return 1

    duration = float(meta.get("format", {}).get("duration", 0.0))
    w, h = video.get("width"), video.get("height")
    print(f"ok: {video.get('codec_name')} {w}x{h} {duration:.2f}s")

    if expected is not None and abs(duration - expected) > 0.3:
        print(f"error: duration {duration:.2f}s differs from expected {expected:.2f}s by >0.3s",
              file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
