#!/usr/bin/env python3
"""Generate iOS AppIcon PNGs by scaling a single 1024×1024 source (no tauri icon transform)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

# Matches lib/app/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/Contents.json
IOS_ICON_SIZES: dict[str, int] = {
    "AppIcon-20x20@2x.png": 40,
    "AppIcon-20x20@3x.png": 60,
    "AppIcon-29x29@2x-1.png": 58,
    "AppIcon-29x29@3x.png": 87,
    "AppIcon-40x40@2x.png": 80,
    "AppIcon-40x40@3x.png": 120,
    "AppIcon-60x60@2x.png": 120,
    "AppIcon-60x60@3x.png": 180,
    "AppIcon-20x20@1x.png": 20,
    "AppIcon-20x20@2x-1.png": 40,
    "AppIcon-29x29@1x.png": 29,
    "AppIcon-29x29@2x.png": 58,
    "AppIcon-40x40@1x.png": 40,
    "AppIcon-40x40@2x-1.png": 80,
    "AppIcon-76x76@1x.png": 76,
    "AppIcon-76x76@2x.png": 152,
    "AppIcon-83.5x83.5@2x.png": 167,
    "AppIcon-512@2x.png": 1024,
}


def flatten_rgb(img: Image.Image, bg: tuple[int, int, int] = (0, 0, 0)) -> Image.Image:
    rgba = img.convert("RGBA")
    out = Image.new("RGB", rgba.size, bg)
    out.paste(rgba, mask=rgba.split()[3])
    return out


def generate(source: Path, out_dir: Path, bg: tuple[int, int, int] = (0, 0, 0)) -> None:
    if not source.is_file():
        raise SystemExit(f"source not found: {source}")
    base = Image.open(source)
    if base.size != (1024, 1024):
        base = base.resize((1024, 1024), Image.Resampling.LANCZOS)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, px in IOS_ICON_SIZES.items():
        resized = base.resize((px, px), Image.Resampling.LANCZOS)
        flatten_rgb(resized, bg).save(out_dir / name, "PNG")
        print(f"wrote {name} ({px}px)")


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    default_source = repo / "lib/app/src-tauri/icons/app-icon-source.png"
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else default_source
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else repo / "lib/app/src-tauri/icons/ios"
    generate(source, out_dir)
    print(f"done → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
