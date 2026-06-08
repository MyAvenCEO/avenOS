#!/usr/bin/env python3
"""
Fetch REAL stock b-roll from Pexels (free API) — videos first, photo fallback.

Real footage beats AI-generated stills for any real-world concept (a person at
a desk, an ocean wave, a city street). Use this for those beats; reserve
generated/abstract imagery for pure metaphors.

How it fits Hyperframes: this downloads a file into a project's `assets/` dir,
then you reference it from `index.html` like any local asset:

    <video class="clip" ... src="assets/stock_ab12cd34.mp4" muted></video>
    <img   class="clip" ... src="assets/stock_ab12cd34.jpg" />

The render file-server is rooted at the project dir, so relative `assets/...`
paths resolve during `hyperframes render`.

Setup (one-time, free):
  1. Create a free key at https://www.pexels.com/api/  (instant)
  2. Put it in the repo-root .env:   PEXELS_API_KEY="<your key>"
     (this script auto-loads that .env), or `export PEXELS_API_KEY=...`.

Usage:
  python3 fetch_stock.py "<search query>" <out_dir> [--photo] [--portrait]
      "<query>"   e.g. "person desk papers working late focus"
      <out_dir>   where to save — usually <project_dir>/assets
      --photo     fetch a still photo instead of a video clip
      --portrait  prefer portrait orientation (for vertical clips)
      --square    prefer square orientation (1:1 — the skill default); else landscape

Prints the saved file path on success. Picks the highest-res file that is
<= 1920 on the long edge (no point pulling 4K for a 1080p comp).
"""
from __future__ import annotations
import os, sys, json, urllib.request, urllib.parse, hashlib, subprocess
from pathlib import Path

TIMEOUT = 30


def _read_pexels_from_env_file(env_path: Path) -> str:
    if not env_path.exists():
        return ""
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("PEXELS_API_KEY"):
            _, _, val = line.partition("=")
            return val.strip().strip('"').strip("'")
    return ""


def _load_env_key() -> str:
    """PEXELS_API_KEY from the environment, falling back to repo-root .env files.

    Works inside a git worktree: checks both the worktree root and the MAIN repo
    root (parent of git-common-dir), since secrets usually live in the latter.
    """
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        return key

    here = Path(__file__).resolve()
    roots: list[Path] = []

    def _git(*args: str) -> str | None:
        try:
            return subprocess.run(
                ["git", "-C", str(here.parent), *args],
                capture_output=True, text=True, check=True,
            ).stdout.strip()
        except Exception:
            return None

    top = _git("rev-parse", "--show-toplevel")
    if top:
        roots.append(Path(top))
    common = _git("rev-parse", "--path-format=absolute", "--git-common-dir")
    if common:
        roots.append(Path(common).parent)  # main repo root (parent of .git)
    if not roots:
        # fallback: .claude/skills/video-edit/scripts -> up 4 = repo root
        roots.append(here.parents[4] if len(here.parents) > 4 else here.parent)

    seen: set[Path] = set()
    for root in roots:
        if root in seen:
            continue
        seen.add(root)
        val = _read_pexels_from_env_file(root / ".env")
        if val:
            return val
    return ""


API = _load_env_key()


def _get(url: str) -> dict:
    # Pexels 403s urllib's default User-Agent, so set an explicit one.
    req = urllib.request.Request(
        url, headers={"Authorization": API, "User-Agent": "video-edit/1.0"}
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "video-edit/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r, open(dest, "wb") as f:
        f.write(r.read())


def fetch_video(query: str, out_dir: Path, orient: str) -> Path | None:
    q = urllib.parse.quote(query)
    data = _get(f"https://api.pexels.com/videos/search?query={q}"
                f"&orientation={orient}&size=medium&per_page=8")
    vids = data.get("videos", [])
    if not vids:
        return None
    best = None
    for v in vids:
        files = [f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4"]
        under = [f for f in files if (f.get("width") or 0) <= 1920]
        pick = max(under or files, key=lambda f: f.get("width") or 0, default=None)
        if pick:
            best = (v, pick); break
    if not best:
        return None
    v, pick = best
    slug = hashlib.sha1((query + str(v.get("id"))).encode()).hexdigest()[:8]
    dest = out_dir / f"stock_{slug}.mp4"
    _download(pick["link"], dest)
    print(f"[pexels:video] '{query}' -> {dest}  ({pick.get('width')}x{pick.get('height')}, by {v.get('user',{}).get('name','?')})")
    return dest


def fetch_photo(query: str, out_dir: Path, orient: str) -> Path | None:
    q = urllib.parse.quote(query)
    data = _get(f"https://api.pexels.com/v1/search?query={q}"
                f"&orientation={orient}&per_page=8")
    photos = data.get("photos", [])
    if not photos:
        return None
    p = photos[0]
    slug = hashlib.sha1((query + str(p.get("id"))).encode()).hexdigest()[:8]
    dest = out_dir / f"stock_{slug}.jpg"
    _download(p["src"]["large2x"], dest)
    print(f"[pexels:photo] '{query}' -> {dest}  (by {p.get('photographer','?')})")
    return dest


def main() -> int:
    if not API:
        print("ERROR: PEXELS_API_KEY not set. Get a free key at "
              "https://www.pexels.com/api/ and put it in the repo-root .env as "
              'PEXELS_API_KEY="..." (or export it).', file=sys.stderr)
        return 3
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) < 2:
        print("usage: fetch_stock.py \"<query>\" <out_dir> [--photo] [--portrait|--square]", file=sys.stderr)
        return 2
    query, out_dir = args[0], Path(args[1]).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    orient = "portrait" if "--portrait" in flags else "square" if "--square" in flags else "landscape"
    try:
        res = (fetch_photo if "--photo" in flags else fetch_video)(query, out_dir, orient)
        if res is None and "--photo" not in flags:
            print("[fallback] no video, trying photo")
            res = fetch_photo(query, out_dir, orient)
        if res is None:
            print(f"no stock result for '{query}'", file=sys.stderr); return 1
        print(str(res))
        return 0
    except Exception as e:
        print(f"fetch failed: {e}", file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())
