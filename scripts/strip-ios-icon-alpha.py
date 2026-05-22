#!/usr/bin/env python3
"""Flatten PNG app icons to RGB (no alpha). Required for App Store Connect iOS uploads."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def strip_alpha(path: Path, bg: tuple[int, int, int] = (0, 0, 0)) -> bool:
    img = Image.open(path)
    if img.mode not in ("RGBA", "LA") and not (img.mode == "P" and "transparency" in img.info):
        if img.mode != "RGB":
            img.convert("RGB").save(path, "PNG")
            return True
        return False
    rgba = img.convert("RGBA")
    out = Image.new("RGB", rgba.size, bg)
    out.paste(rgba, mask=rgba.split()[3])
    out.save(path, "PNG")
    return True


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: strip-ios-icon-alpha.py <file-or-dir> [...]", file=sys.stderr)
        return 1
    changed = 0
    for arg in sys.argv[1:]:
        p = Path(arg)
        files = p.rglob("*.png") if p.is_dir() else [p]
        for f in files:
            if not f.is_file():
                continue
            if strip_alpha(f):
                changed += 1
                print(f"stripped alpha: {f}")
    print(f"done ({changed} file(s) updated)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
