#!/usr/bin/env python3
"""
compile_plan.py — the Remotion-props → Hyperframes-HTML bridge.

The original Remotion editor read its plan (broll_plan.json + captions +
zoom) straight into the React comp via props.json. Hyperframes has no
props.json: a "composition" is a plain `index.html` whose visible elements
carry timing data-attributes and whose animation is a single *paused* GSAP
timeline registered on `window.__timelines["<composition-id>"]`. Hyperframes
seeks that timeline frame-by-frame in headless Chrome and pipes frames to
ffmpeg → mp4 (wrapped by scripts/render.sh → `npx hyperframes render <dir>`).

This script is that missing bridge. It compiles a project's plan into an
`index.html`:

    input  =  <project_dir>/broll_plan.json        (the beats — required)
              <project_dir>/captions_plan.json      (optional, from captions_plan.py)
              <project_dir>/zoom_plan.json          (optional, from zoom_plan.py)
              <project_dir>/transcript.json         (optional fallback for captions)
              <project_dir>/assets/                 (media referenced by beats)
    output =  <project_dir>/index.html

Each beat `kind` becomes an HTML+CSS block animated by GSAP — the kinds, their
semantics, fields and rules are kept identical to the original skill. Media
(<video>/<audio>/<img>) always carries an id + src; videos are muted. Captions
keep the original lime (#CFFF05) current-word styling.

Usage:
    compile_plan.py <project_dir> [--id <composition-id>] [--duration <sec>]
                    [--resolution square|landscape|portrait]

Defaults: composition id = basename(project_dir); resolution = square
(1080×1080, data-resolution="square") per the skill's house default; duration =
auto (max beat/caption/zoom end_sec, rounded up).

Then:  bash scripts/render.sh <project_dir> <id> "<Title>"
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from html import escape
from pathlib import Path

# ── Brand palette (SKILL §4f — locked source of truth) ─────────────────────
RAISIN_BLACK = "#0F121A"   # default backdrop, card fill, letterbox bars
RAISIN_DEEP = "#1E2434"    # secondary surfaces, card variants
RAISIN_STEEL = "#343E5B"   # dividers
SILVER = "#B5BFC2"         # body text on dark
SILVER_LIGHT = "#D2D8DA"
SILVER_PALE = "#E9ECED"
NEO_LIME = "#CFFF05"       # the single monogamous accent

# Resolutions (data-resolution on <html>, matching data-width/height on root).
RESOLUTIONS = {
    "square": (1080, 1080),
    "landscape": (1920, 1080),
    "portrait": (1080, 1920),
}

# Kinds that carry a media file in `image_path`; the file must exist on disk.
IMAGE_KINDS = {"static", "icon", "video", "ai_image_on_grid", "image_card"}

# Eased zoom curve — Remotion's useGlobalZoom punch-in (SKILL: cubic-bezier
# 0.4,0,0.2,1, 1.0 → 1.04..1.15). GSAP spells the same bezier as an ease.
ZOOM_EASE = "power2.inOut"


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════
def _load(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"error: {path} is not valid JSON: {e}")


def _num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _esc(s) -> str:
    """HTML-escape, turning authored `\\n` into <br> (titles/headlines use it)."""
    return escape(str(s)).replace("\n", "<br>")


def resolve_asset(project_dir: Path, image_path: str) -> str | None:
    """Return a project-relative src for a beat asset, or None if missing.

    The render file-server is rooted at the project dir, so the emitted src
    must be relative to it (e.g. `assets/foo.png`). We search the same
    locations lint_plan.py does so an authored `broll/1.png` still resolves.
    """
    if not image_path:
        return None
    name = Path(image_path).name
    candidates = [
        project_dir / image_path,
        project_dir / "assets" / name,
        project_dir / "broll" / name,
        project_dir / "motion" / name,
        project_dir / name,
    ]
    for c in candidates:
        if c.exists():
            try:
                return c.relative_to(project_dir).as_posix()
            except ValueError:
                return c.as_posix()
    return None


# ════════════════════════════════════════════════════════════════════════════
# Per-kind HTML emitters
#
# Each returns the inner HTML for a beat's `.clip` block. The caller wraps it
# in a positioned container carrying the timing data-attributes and a unique
# id, so the GSAP timeline can fade/kill it. Kinds, fields and semantics mirror
# the original skill verbatim — this only changes the rendering substrate from
# React/Remotion to HTML+GSAP.
# ════════════════════════════════════════════════════════════════════════════
def _takeover_open(extra_style: str = "") -> str:
    """A full-frame raisin takeover surface (hard-kills the speaker beneath)."""
    return (
        f'<div class="takeover" style="background:{RAISIN_BLACK};{extra_style}">'
        '<div class="grid-bg"></div>'
    )


def emit_static(beat, src):
    # Full-screen image takeover (SKILL: default for most beats). `fit`
    # defaults to contain — the comp letterboxes onto raisin black so the
    # whole image is always visible (SKILL §3c).
    fit = beat.get("fit", "contain")
    return (
        _takeover_open()
        + f'<img class="media" src="{escape(src)}" '
        f'style="width:100%;height:100%;object-fit:{escape(fit)}" alt="">'
        + "</div>"
    )


def emit_video(beat, src):
    # Full-screen MP4 takeover. Muted (we never want the b-roll's own audio
    # competing with the voice track). `overlay:true` would make it a floating
    # card, but kept simple here as a takeover surface.
    fit = beat.get("fit", "cover")
    return (
        _takeover_open()
        + f'<video class="media" src="{escape(src)}" muted playsinline '
        f'style="width:100%;height:100%;object-fit:{escape(fit)}"></video>'
        + "</div>"
    )


def emit_icon(beat, src):
    # Small floating card — brief brand/logo flash. Default anchor center
    # (SKILL: corner anchors read worse). NOT a takeover: leaves speaker
    # visible, transparent backdrop.
    label = _esc(beat.get("label", "")) if beat.get("label") else ""
    cap = f'<div class="icon-label">{label}</div>' if label else ""
    return (
        '<div class="icon-card">'
        f'<img class="media" src="{escape(src)}" '
        'style="max-width:70%;max-height:70%;object-fit:contain" alt="">'
        f"{cap}</div>"
    )


def emit_image_card(beat, src):
    # b-roll image in a glassy bottom-half card; speaker stays visible above
    # (SKILL §4aj). Optional caption strip.
    cap = beat.get("caption", "")
    cap_html = f'<div class="card-caption">{_esc(cap)}</div>' if cap else ""
    return (
        '<div class="image-card">'
        f'<img class="media" src="{escape(src)}" '
        'style="width:100%;height:100%;object-fit:cover" alt="">'
        f"{cap_html}</div>"
    )


def emit_list(beat):
    # Programmatic numbered list overlay — REQUIRED when the speaker enumerates
    # (SKILL §4 / §4e). Items can be plain strings or {text, appear_sec}; we
    # stagger reveal via GSAP using appear_sec when present.
    title = beat.get("title", "")
    items = beat.get("items", []) or []
    rows = []
    for n, it in enumerate(items, 1):
        text = it.get("text", "") if isinstance(it, dict) else str(it)
        rows.append(
            f'<li class="li-item"><span class="li-num">{n:02d}</span>'
            f'<span class="li-text">{_esc(text)}</span></li>'
        )
    title_html = f'<div class="list-title">{_esc(title)}</div>' if title else ""
    return (
        _takeover_open()
        + f'<div class="list-card">{title_html}<ol class="list-ol">'
        + "".join(rows)
        + "</ol></div></div>"
    )


def emit_stat_punch(beat):
    # The hero number on a grid (SKILL §4x: requires value + caption).
    pre = beat.get("pre_label", "")
    pre_html = f'<div class="sp-pre">{_esc(pre)}</div>' if pre else ""
    return (
        _takeover_open()
        + '<div class="sp-wrap">'
        + pre_html
        + f'<div class="sp-value">{_esc(beat.get("value", ""))}</div>'
        + f'<div class="sp-caption">{_esc(beat.get("caption", ""))}</div>'
        + "</div></div>"
    )


def emit_callout(beat):
    # Claim with a single highlighted phrase (requires callout_prefix +
    # callout_highlight).
    return (
        _takeover_open()
        + '<div class="callout-wrap">'
        + f'<span class="callout-prefix">{_esc(beat.get("callout_prefix", ""))}</span> '
        + f'<span class="callout-hl">{_esc(beat.get("callout_highlight", ""))}</span>'
        + (f'<div class="callout-suffix">{_esc(beat.get("callout_suffix"))}</div>'
           if beat.get("callout_suffix") else "")
        + "</div></div>"
    )


def emit_quote_pull(beat):
    # Typewriter quote — the takeaway line (requires quote_text). The
    # original derived a typewriter; here the line fades/rises in via GSAP.
    attr = beat.get("attribution", "")
    attr_html = f'<div class="quote-attr">— {_esc(attr)}</div>' if attr else ""
    return (
        _takeover_open()
        + '<div class="quote-wrap">'
        + f'<div class="quote-mark">&ldquo;</div>'
        + f'<div class="quote-text">{_esc(beat.get("quote_text", ""))}</div>'
        + attr_html
        + "</div></div>"
    )


def emit_vs_split(beat):
    # Top/bottom contrast labels + items (requires top_label/bottom_label +
    # non-empty top_items/bottom_items, SKILL §4w). Kind kept for backward-
    # compat with old plans (SKILL §4ca bans authoring NEW ones).
    def side(label, items, winner):
        lis = "".join(f"<li>{_esc(i)}</li>" for i in (items or []))
        cls = "vs-side vs-win" if winner else "vs-side"
        return (
            f'<div class="{cls}"><div class="vs-label">{_esc(label)}</div>'
            f'<ul class="vs-items">{lis}</ul></div>'
        )
    win = beat.get("winner", "")
    return (
        _takeover_open()
        + '<div class="vs-wrap">'
        + side(beat.get("top_label", ""), beat.get("top_items"), win == "top")
        + '<div class="vs-divider">VS</div>'
        + side(beat.get("bottom_label", ""), beat.get("bottom_items"), win == "bottom")
        + "</div></div>"
    )


def emit_title_card(beat):
    # number + title (lighter than cinematic_title; requires number + title).
    return (
        _takeover_open()
        + '<div class="tc-wrap">'
        + f'<div class="tc-number">{_esc(beat.get("number", ""))}</div>'
        + f'<div class="tc-title">{_esc(beat.get("title", ""))}</div>'
        + (f'<div class="tc-sub">{_esc(beat.get("subtitle"))}</div>'
           if beat.get("subtitle") else "")
        + "</div></div>"
    )


def emit_cinematic_title(beat):
    # chapter + bold title + subtitle (requires chapter + title).
    return (
        _takeover_open()
        + '<div class="ct-wrap">'
        + f'<div class="ct-chapter">{_esc(beat.get("chapter", ""))}</div>'
        + f'<div class="ct-rule"></div>'
        + f'<div class="ct-title">{_esc(beat.get("title", ""))}</div>'
        + (f'<div class="ct-sub">{_esc(beat.get("subtitle"))}</div>'
           if beat.get("subtitle") else "")
        + "</div></div>"
    )


def emit_chapter_bar(beat):
    # Bottom-third bar with chapter number + title (partial overlay — speaker
    # stays visible; requires chapter_number + chapter_title).
    return (
        '<div class="chapter-bar">'
        f'<span class="cb-num">{_esc(beat.get("chapter_number", ""))}</span>'
        f'<span class="cb-title">{_esc(beat.get("chapter_title", ""))}</span>'
        "</div>"
    )


def emit_hook_title(beat):
    # The premium cold-open lockup (SKILL §4ae): small lime kicker, a thin lime
    # rule, a huge hero line. Cardless, lower-third by default. `flank` mode
    # straddles the speaker's face with left_text/right_text.
    if beat.get("align") == "flank":
        return (
            '<div class="hook flank">'
            f'<div class="hook-left">{_esc(beat.get("left_text", ""))}</div>'
            f'<div class="hook-right">{_esc(beat.get("right_text", ""))}</div>'
            "</div>"
        )
    logo = ""
    if beat.get("logo_path") and beat.get("_logo_src"):
        logo = (f'<div class="hook-logo"><img class="media" '
                f'src="{escape(beat["_logo_src"])}" alt=""></div>')
    return (
        '<div class="hook">'
        + logo
        + f'<div class="hook-kicker">{_esc(beat.get("kicker", ""))}</div>'
        + '<div class="hook-rule"></div>'
        + f'<div class="hook-title">{_esc(beat.get("title", ""))}</div>'
        + "</div>"
    )


def emit_word_pop(beat):
    # Cardless typography over the speaker (SKILL §4y/§4ac): one item at a time,
    # each at its own appear_sec. `{...}` spans render in script font (lime).
    def render_text(t: str) -> str:
        # Split on {...} → script-font spans; rest is block.
        out, i = [], 0
        s = str(t)
        while i < len(s):
            if s[i] == "{":
                j = s.find("}", i)
                if j == -1:
                    out.append(_esc(s[i:]))
                    break
                out.append(f'<span class="wp-script">{_esc(s[i+1:j])}</span>')
                i = j + 1
            else:
                j = s.find("{", i)
                if j == -1:
                    out.append(_esc(s[i:]))
                    break
                out.append(_esc(s[i:j]))
                i = j
        return "".join(out)

    items = beat.get("items", []) or []
    spans = []
    for n, it in enumerate(items):
        text = it.get("text", "") if isinstance(it, dict) else str(it)
        accent = isinstance(it, dict) and it.get("accent")
        cls = "wp-item wp-accent" if accent else "wp-item"
        spans.append(f'<div class="{cls}">{render_text(text)}</div>')
    return '<div class="wordpop">' + "".join(spans) + "</div>"


def emit_headline_card(beat):
    # News-clipping card in the bottom-half glass frame (requires kicker +
    # headline). A real reported fact, not a metaphor (SKILL §4au).
    return (
        '<div class="image-card headline">'
        f'<div class="hc-kicker">{_esc(beat.get("kicker", ""))}</div>'
        f'<div class="hc-headline">{_esc(beat.get("headline", ""))}</div>'
        '<div class="hc-rule"></div>'
        + (f'<div class="hc-dek">{_esc(beat.get("dek"))}</div>'
           if beat.get("dek") else "")
        + "</div>"
    )


def emit_generic(beat):
    # Fallback takeover for any kind we don't render bespoke yet — show the
    # most title-like field so the beat never renders truly blank.
    for f in ("title", "headline", "caption", "value", "kicker", "chapter_title"):
        if beat.get(f):
            return (
                _takeover_open()
                + f'<div class="generic-text">{_esc(beat[f])}</div></div>'
            )
    return _takeover_open() + "</div>"


# kind → (emitter, needs_media). Takeovers hard-kill the speaker; partials don't.
EMITTERS = {
    "static": (emit_static, True),
    "video": (emit_video, True),
    "icon": (emit_icon, True),
    "ai_image_on_grid": (emit_static, True),
    "image_card": (emit_image_card, True),
    "list": (emit_list, False),
    "stat_punch": (emit_stat_punch, False),
    "callout": (emit_callout, False),
    "quote_pull": (emit_quote_pull, False),
    "vs_split": (emit_vs_split, False),
    "title_card": (emit_title_card, False),
    "cinematic_title": (emit_cinematic_title, False),
    "chapter_bar": (emit_chapter_bar, False),
    "hook_title": (emit_hook_title, False),
    "word_pop": (emit_word_pop, False),
    "headline_card": (emit_headline_card, False),
}

# Partial overlays leave the speaker visible (no raisin takeover backdrop) and
# may overlap other beats. Everything else is an exclusive full-frame takeover.
PARTIAL_KINDS = {
    "icon", "image_card", "chapter_bar", "hook_title", "word_pop",
    "headline_card",
}


# ════════════════════════════════════════════════════════════════════════════
# Caption HTML  (lime current-word; styling identical to the original)
# ════════════════════════════════════════════════════════════════════════════
def caption_lines(project_dir: Path) -> list[dict]:
    """Load caption lines. Prefer captions_plan.json (from captions_plan.py);
    fall back to transcript.json (Hyperframes' flat [{start,end,word}]) grouped
    into ~6-word lines."""
    cap = _load(project_dir / "captions_plan.json")
    if isinstance(cap, list) and cap:
        return cap
    tr = _load(project_dir / "transcript.json")
    if isinstance(tr, list) and tr:
        lines, cur = [], []
        for w in tr:
            cur.append({
                "text": str(w.get("word", "")).strip(),
                "start_sec": _num(w.get("start")),
                "end_sec": _num(w.get("end")),
            })
            ends_sentence = str(w.get("word", "")).strip().endswith((".", "!", "?"))
            if len(cur) >= 6 or ends_sentence:
                lines.append({
                    "start_sec": cur[0]["start_sec"],
                    "end_sec": cur[-1]["end_sec"],
                    "words": cur, "emphasis": False,
                })
                cur = []
        if cur:
            lines.append({
                "start_sec": cur[0]["start_sec"], "end_sec": cur[-1]["end_sec"],
                "words": cur, "emphasis": False,
            })
        return lines
    return []


def emit_captions(lines: list[dict]) -> tuple[str, list[tuple[str, float, float, list[dict]]]]:
    """Return (html, timeline_specs). Each caption line is its own clip; words
    inside carry their own start/end so the timeline can light the CURRENT word
    neo-lime (the teleprompter follow)."""
    html_blocks = []
    specs = []  # (line_id, start, end, words)
    for i, ln in enumerate(lines):
        lid = f"cap-{i}"
        words = ln.get("words") or []
        emph = "cap-line cap-emph" if ln.get("emphasis") else "cap-line"
        spans = []
        for j, w in enumerate(words):
            spans.append(
                f'<span class="cap-word" id="{lid}-w{j}">{_esc(w.get("text", ""))}</span>'
            )
        html_blocks.append(
            f'<div class="{emph}" id="{lid}" '
            f'data-start="{_num(ln.get("start_sec")):.3f}" '
            f'data-duration="{max(0.04, _num(ln.get("end_sec")) - _num(ln.get("start_sec"))):.3f}" '
            f'data-track-index="40">{" ".join(spans)}</div>'
        )
        specs.append((lid, _num(ln.get("start_sec")), _num(ln.get("end_sec")), words))
    return "\n      ".join(html_blocks), specs


# ════════════════════════════════════════════════════════════════════════════
# Compile
# ════════════════════════════════════════════════════════════════════════════
def compile_plan(project_dir: Path, comp_id: str, resolution: str,
                 duration: float | None) -> str:
    if resolution not in RESOLUTIONS:
        sys.exit(f"error: --resolution must be one of {', '.join(RESOLUTIONS)}")
    W, H = RESOLUTIONS[resolution]

    plan = _load(project_dir / "broll_plan.json")
    if not isinstance(plan, list):
        sys.exit(f"error: {project_dir/'broll_plan.json'} missing or not a JSON array")
    zooms = _load(project_dir / "zoom_plan.json") or []
    caps = caption_lines(project_dir)

    # ── Resolve media + build per-beat blocks ──────────────────────────────
    beat_blocks = []        # html
    beat_specs = []         # (clip_id, start, end, kind, is_partial)
    max_end = 0.0
    skipped = []

    for idx, beat in enumerate(plan):
        kind = beat.get("kind", "static")
        start = _num(beat.get("start_sec"))
        end = _num(beat.get("end_sec"))
        if end <= start:
            skipped.append(f"beat #{idx} ({kind}): end_sec <= start_sec — skipped")
            continue
        max_end = max(max_end, end)

        emitter, needs_media = EMITTERS.get(kind, (emit_generic, False))

        inner = None
        if needs_media:
            src = resolve_asset(project_dir, beat.get("image_path", ""))
            if src is None:
                skipped.append(
                    f"beat #{idx} ({kind}): image_path "
                    f"{beat.get('image_path')!r} not found on disk — skipped")
                continue
            inner = emitter(beat, src)
        elif kind == "hook_title" and beat.get("logo_path"):
            beat = dict(beat)
            beat["_logo_src"] = resolve_asset(project_dir, beat["logo_path"])
            inner = emitter(beat)
        else:
            inner = emitter(beat)

        is_partial = kind in PARTIAL_KINDS
        cid = f"beat-{idx}"
        track = 30 if is_partial else 20  # partials ride above takeovers
        # `data-resolution`/timing per the Hyperframes contract: every timed
        # element is a .clip with data-start/data-duration/data-track-index.
        beat_blocks.append(
            f'<div id="{cid}" class="clip beat {"partial" if is_partial else "takeover-clip"}" '
            f'data-start="{start:.3f}" data-duration="{(end - start):.3f}" '
            f'data-track-index="{track}" '
            f'data-kind="{escape(kind)}">{inner}</div>'
        )
        beat_specs.append((cid, start, end, kind, is_partial))

    # ── Captions ───────────────────────────────────────────────────────────
    cap_html, cap_specs = emit_captions(caps)
    for _, _, e, _ in cap_specs:
        max_end = max(max_end, e)
    for z in zooms:
        max_end = max(max_end, _num(z.get("end_sec")))

    # ── Composition duration ───────────────────────────────────────────────
    if duration is None:
        duration = math.ceil(max_end) if max_end > 0 else 5.0
    duration = max(duration, 0.5)

    # ── Build the paused GSAP timeline ─────────────────────────────────────
    # Per-beat: fade IN at start, fade OUT just before end, then a HARD KILL
    # (autoAlpha 0, instant) at end so a takeover never bleeds into the next.
    # Plus the global zoom punch-ins as scale tweens on the speaker root.
    tl = []
    tl.append("      window.__timelines = window.__timelines || {};")
    tl.append("      const tl = gsap.timeline({ paused: true });")
    tl.append("      // start everything hidden; the timeline reveals each clip in its window")
    tl.append('      gsap.set(".beat, .cap-line", { autoAlpha: 0 });')

    FADE = 0.22  # fade in/out duration (seconds)
    for cid, start, end, kind, is_partial in beat_specs:
        dur = end - start
        fin = min(FADE, dur / 2)
        # entrance — takeovers a touch of upward drift; partials a soft pop.
        if is_partial:
            tl.append(
                f'      tl.fromTo("#{cid}", {{ autoAlpha: 0, scale: 0.94 }}, '
                f'{{ autoAlpha: 1, scale: 1, duration: {fin:.3f}, '
                f'ease: "power2.out" }}, {start:.3f});')
        else:
            tl.append(
                f'      tl.fromTo("#{cid}", {{ autoAlpha: 0, y: 24 }}, '
                f'{{ autoAlpha: 1, y: 0, duration: {fin:.3f}, '
                f'ease: "power3.out" }}, {start:.3f});')
        # fade out, then a hard kill exactly at end_sec
        fade_out_at = max(start + fin, end - fin)
        tl.append(
            f'      tl.to("#{cid}", {{ autoAlpha: 0, duration: {fin:.3f}, '
            f'ease: "power1.in" }}, {fade_out_at:.3f});')
        tl.append(
            f'      tl.set("#{cid}", {{ autoAlpha: 0 }}, {end:.3f});  // hard kill')
        # staggered item reveals for multi-item kinds (list / word_pop) via
        # appear_sec when present — items default-hidden, popped at their time.
        if kind in ("list", "word_pop"):
            item_sel = ".li-item" if kind == "list" else ".wp-item"
            tl.append(f'      tl.set("#{cid} {item_sel}", {{ autoAlpha: 0 }}, {start:.3f});')

    # per-item appear_sec staggers (need the beat index → use plan order)
    for idx, beat in enumerate(plan):
        kind = beat.get("kind")
        if kind not in ("list", "word_pop"):
            continue
        items = beat.get("items", []) or []
        bstart = _num(beat.get("start_sec"))
        bend = _num(beat.get("end_sec"))
        if bend <= bstart:
            continue
        sel = ".li-item" if kind == "list" else ".wp-item"
        n = len(items)
        for j, it in enumerate(items):
            appear = None
            if isinstance(it, dict) and "appear_sec" in it:
                appear = _num(it["appear_sec"])
            else:
                # plain string → auto-stagger across first 60% of the window
                span = (bend - bstart) * 0.6
                appear = bstart + (span * (j / max(1, n)))
            appear = min(max(appear, bstart), bend - 0.05)
            tl.append(
                f'      tl.fromTo("#beat-{idx} {sel}:nth-child({j+1})", '
                f'{{ autoAlpha: 0, y: 14 }}, {{ autoAlpha: 1, y: 0, '
                f'duration: 0.3, ease: "power2.out" }}, {appear:.3f});')

    # ── Global zoom punch-ins (Remotion useGlobalZoom) ─────────────────────
    # GSAP scale tweens on the speaker/root: 1.0 → scale → 1.0, eased.
    for z in zooms:
        zs = _num(z.get("start_sec"))
        ze = _num(z.get("end_sec"))
        scale = _num(z.get("scale"), 1.06)
        if ze <= zs:
            continue
        up = min(0.5, (ze - zs) / 2)
        peak = zs + up
        tl.append(
            f'      tl.to("#speaker", {{ scale: {scale:.3f}, duration: {up:.3f}, '
            f'ease: "{ZOOM_EASE}" }}, {zs:.3f});')
        tl.append(
            f'      tl.to("#speaker", {{ scale: 1.0, duration: {max(0.2, ze - peak):.3f}, '
            f'ease: "{ZOOM_EASE}" }}, {peak:.3f});')

    # ── Caption word-follow (current word lime #CFFF05) ────────────────────
    for lid, cstart, cend, words in cap_specs:
        cdur = max(0.04, cend - cstart)
        cfin = min(0.12, cdur / 2)
        tl.append(
            f'      tl.fromTo("#{lid}", {{ autoAlpha: 0, y: 12 }}, '
            f'{{ autoAlpha: 1, y: 0, duration: {cfin:.3f}, ease: "power2.out" }}, {cstart:.3f});')
        tl.append(
            f'      tl.set("#{lid}", {{ autoAlpha: 0 }}, {cend:.3f});')
        for j, w in enumerate(words):
            ws = _num(w.get("start_sec"))
            we = _num(w.get("end_sec"))
            if we <= ws:
                continue
            tl.append(
                f'      tl.set("#{lid}-w{j}", {{ color: "{NEO_LIME}" }}, {ws:.3f});')
            tl.append(
                f'      tl.set("#{lid}-w{j}", {{ color: "{SILVER_PALE}" }}, {we:.3f});')

    tl.append(f'      window.__timelines["{comp_id}"] = tl;')
    timeline_js = "\n".join(tl)

    # ── Assemble the document ──────────────────────────────────────────────
    beats_html = "\n      ".join(beat_blocks) if beat_blocks else "<!-- no beats -->"
    html = _DOCUMENT.format(
        resolution=resolution, W=W, H=H, comp_id=escape(comp_id),
        duration=f"{duration:.3f}",
        RAISIN_BLACK=RAISIN_BLACK, RAISIN_DEEP=RAISIN_DEEP, RAISIN_STEEL=RAISIN_STEEL,
        SILVER=SILVER, SILVER_LIGHT=SILVER_LIGHT, SILVER_PALE=SILVER_PALE,
        NEO_LIME=NEO_LIME, W_value=int(W * 0.30),
        beats_html=beats_html, captions_html=cap_html, timeline_js=timeline_js,
    )

    # ── Report ─────────────────────────────────────────────────────────────
    print(f"[compile_plan] {project_dir}")
    print(f"  composition id : {comp_id}")
    print(f"  resolution     : {resolution} ({W}x{H})")
    print(f"  duration       : {duration:.2f}s")
    print(f"  beats rendered : {len(beat_specs)} / {len(plan)}")
    print(f"  caption lines  : {len(cap_specs)}")
    print(f"  zoom punches   : {sum(1 for z in zooms if _num(z.get('end_sec')) > _num(z.get('start_sec')))}")
    for s in skipped:
        print(f"  skipped: {s}")
    return html


# ════════════════════════════════════════════════════════════════════════════
# The HTML shell  (square default; root carries data-composition-id)
# ════════════════════════════════════════════════════════════════════════════
_DOCUMENT = """<!doctype html>
<html lang="en" data-resolution="{resolution}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <!-- COMPILED by scripts/compile_plan.py — do not hand-edit; re-run the
         compiler against the project's broll_plan.json / captions_plan.json /
         zoom_plan.json instead. -->
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Caveat:wght@700&display=swap" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{
        width: {W}px; height: {H}px; overflow: hidden;
        background: {RAISIN_BLACK};
        font-family: "Space Grotesk", "Inter", system-ui, sans-serif;
        color: {SILVER_PALE};
      }}
      #root {{ position: relative; width: {W}px; height: {H}px; }}

      /* Speaker / background layer — the global zoom punch-ins scale THIS. */
      #speaker {{
        position: absolute; inset: 0; transform-origin: 50% 50%;
        background: {RAISIN_BLACK};
        display: flex; align-items: center; justify-content: center;
      }}
      #speaker > video, #speaker > img {{
        width: 100%; height: 100%; object-fit: cover;
      }}

      /* Every beat is an absolutely-positioned full-frame layer. */
      .beat {{ position: absolute; inset: 0; }}
      .takeover {{ position: absolute; inset: 0; display: flex;
        align-items: center; justify-content: center; }}
      .media {{ display: block; }}

      /* Cloudy grid texture under takeovers (SKILL §4an). */
      .grid-bg {{
        position: absolute; inset: 0; opacity: 0.5;
        background-image:
          linear-gradient(rgba(52,62,91,0.35) 1px, transparent 1px),
          linear-gradient(90deg, rgba(52,62,91,0.35) 1px, transparent 1px);
        background-size: 64px 64px;
        -webkit-mask-image: radial-gradient(circle at 50% 40%, #000 0%, transparent 75%);
        mask-image: radial-gradient(circle at 50% 40%, #000 0%, transparent 75%);
      }}

      /* ── icon (floating card) ──────────────────────────────────────── */
      .icon-card {{ position: absolute; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        width: 38%; aspect-ratio: 1; border-radius: 28px;
        background: {RAISIN_DEEP}; border: 2px solid {NEO_LIME};
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 14px; padding: 28px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.55); }}
      .icon-label {{ font-size: 28px; font-weight: 700; letter-spacing: 1px;
        text-transform: uppercase; color: {SILVER_PALE}; }}

      /* ── image_card / headline_card (glassy bottom-half) ───────────── */
      .image-card {{ position: absolute; left: 5%; right: 5%; bottom: 5%;
        height: 46%; border-radius: 28px; overflow: hidden;
        background: rgba(15,18,26,0.55); backdrop-filter: blur(14px);
        border: 1.5px solid {NEO_LIME};
        box-shadow: 0 0 60px rgba(207,255,5,0.18), 0 20px 60px rgba(0,0,0,0.5); }}
      .image-card .media {{ width: 100%; height: 100%; }}
      .card-caption {{ position: absolute; left: 0; right: 0; bottom: 0;
        padding: 16px 24px; font-size: 30px; font-weight: 700;
        background: linear-gradient(transparent, rgba(15,18,26,0.92));
        color: {SILVER_PALE}; }}
      .headline {{ padding: 36px 40px; display: flex; flex-direction: column;
        gap: 16px; justify-content: center; }}
      .hc-kicker {{ font-size: 26px; font-weight: 700; letter-spacing: 3px;
        text-transform: uppercase; color: {NEO_LIME}; }}
      .hc-headline {{ font-size: 56px; font-weight: 700; line-height: 1.05; }}
      .hc-rule {{ height: 2px; background: {RAISIN_STEEL}; }}
      .hc-dek {{ font-size: 28px; color: {SILVER}; }}

      /* ── list ──────────────────────────────────────────────────────── */
      .list-card {{ position: relative; width: 80%; }}
      .list-title {{ font-size: 44px; font-weight: 700; color: {SILVER_PALE};
        margin-bottom: 28px; }}
      .list-ol {{ list-style: none; display: flex; flex-direction: column; gap: 22px; }}
      .li-item {{ display: flex; align-items: baseline; gap: 22px; }}
      .li-num {{ font-size: 40px; font-weight: 700; color: {NEO_LIME};
        min-width: 64px; }}
      .li-text {{ font-size: 42px; font-weight: 500; color: {SILVER_PALE};
        line-height: 1.15; }}

      /* ── stat_punch ────────────────────────────────────────────────── */
      .sp-wrap {{ position: relative; text-align: center; }}
      .sp-pre {{ font-size: 32px; font-weight: 700; letter-spacing: 3px;
        text-transform: uppercase; color: {SILVER}; margin-bottom: 12px; }}
      .sp-value {{ font-size: {W_value}px; font-weight: 700; line-height: 0.92;
        color: {NEO_LIME}; white-space: pre-line; }}
      .sp-caption {{ font-size: 40px; font-weight: 500; color: {SILVER_PALE};
        margin-top: 18px; }}

      /* ── callout ───────────────────────────────────────────────────── */
      .callout-wrap {{ position: relative; width: 78%; text-align: center;
        font-size: 60px; font-weight: 700; line-height: 1.15; }}
      .callout-prefix {{ color: {SILVER_PALE}; }}
      .callout-hl {{ color: {RAISIN_BLACK}; background: {NEO_LIME};
        padding: 2px 14px; border-radius: 8px; }}
      .callout-suffix {{ display: block; margin-top: 16px; color: {SILVER_PALE}; }}

      /* ── quote_pull ────────────────────────────────────────────────── */
      .quote-wrap {{ position: relative; width: 80%; text-align: center; }}
      .quote-mark {{ font-size: 120px; line-height: 0.4; color: {NEO_LIME}; }}
      .quote-text {{ font-size: 58px; font-weight: 700; line-height: 1.18;
        color: {SILVER_PALE}; }}
      .quote-attr {{ margin-top: 26px; font-size: 30px; color: {SILVER}; }}

      /* ── vs_split ──────────────────────────────────────────────────── */
      .vs-wrap {{ position: relative; width: 82%; display: flex;
        flex-direction: column; gap: 18px; }}
      .vs-side {{ background: {RAISIN_DEEP}; border-radius: 20px; padding: 26px 32px;
        border: 1.5px solid {RAISIN_STEEL}; }}
      .vs-win {{ border-color: {NEO_LIME}; box-shadow: 0 0 40px rgba(207,255,5,0.18); }}
      .vs-label {{ font-size: 32px; font-weight: 700; letter-spacing: 2px;
        text-transform: uppercase; color: {NEO_LIME}; margin-bottom: 14px; }}
      .vs-items {{ list-style: none; display: flex; flex-direction: column; gap: 8px; }}
      .vs-items li {{ font-size: 30px; color: {SILVER_PALE}; }}
      .vs-divider {{ text-align: center; font-size: 34px; font-weight: 700;
        color: {SILVER}; }}

      /* ── title_card / cinematic_title ──────────────────────────────── */
      .tc-wrap, .ct-wrap {{ position: relative; text-align: center; width: 80%; }}
      .tc-number {{ font-size: 120px; font-weight: 700; color: {NEO_LIME};
        line-height: 1; }}
      .tc-title {{ font-size: 64px; font-weight: 700; margin-top: 8px; }}
      .tc-sub, .ct-sub {{ font-size: 34px; color: {SILVER}; margin-top: 16px; }}
      .ct-chapter {{ font-size: 28px; font-weight: 700; letter-spacing: 4px;
        text-transform: uppercase; color: {NEO_LIME}; }}
      .ct-rule {{ width: 120px; height: 3px; background: {NEO_LIME};
        margin: 18px auto; }}
      .ct-title {{ font-size: 80px; font-weight: 700; line-height: 1.04; }}

      /* ── chapter_bar (partial) ─────────────────────────────────────── */
      .chapter-bar {{ position: absolute; left: 0; right: 0; bottom: 12%;
        display: flex; align-items: center; gap: 18px; padding: 18px 48px;
        background: linear-gradient(90deg, rgba(15,18,26,0.92), transparent); }}
      .cb-num {{ font-size: 40px; font-weight: 700; color: {RAISIN_BLACK};
        background: {NEO_LIME}; padding: 4px 16px; border-radius: 8px; }}
      .cb-title {{ font-size: 40px; font-weight: 700; color: {SILVER_PALE}; }}

      /* ── hook_title (cardless premium lockup) ──────────────────────── */
      .hook {{ position: absolute; left: 0; right: 0; top: 60%;
        transform: translateY(-50%); text-align: center; padding: 0 6%; }}
      .hook-logo img {{ width: 14%; min-width: 120px; border-radius: 16px;
        background: #fff; padding: 10px; margin: 0 auto 20px;
        box-shadow: 0 0 0 2px {NEO_LIME}; }}
      .hook-kicker {{ font-size: 30px; font-weight: 700; letter-spacing: 5px;
        text-transform: uppercase; color: {NEO_LIME}; }}
      .hook-rule {{ width: 90px; height: 3px; background: {NEO_LIME};
        margin: 16px auto; }}
      .hook-title {{ font-size: 120px; font-weight: 700; line-height: 0.98;
        text-shadow: 0 4px 30px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.9); }}
      .hook.flank {{ display: flex; justify-content: space-between; top: 22%; }}
      .hook-left, .hook-right {{ font-size: 88px; font-weight: 700;
        line-height: 0.98; }}
      .hook-left {{ text-align: left; }} .hook-right {{ text-align: right; color: {NEO_LIME}; }}

      /* ── word_pop (cardless, lower third) ──────────────────────────── */
      .wordpop {{ position: absolute; left: 0; right: 0; top: 72%;
        transform: translateY(-50%); text-align: center; padding: 0 8%; }}
      .wp-item {{ position: absolute; left: 0; right: 0;
        font-size: 84px; font-weight: 700; text-transform: uppercase;
        line-height: 1.0; color: {SILVER_PALE};
        text-shadow: 0 4px 24px rgba(0,0,0,0.85); }}
      .wp-accent {{ color: {NEO_LIME}; }}
      .wp-script {{ font-family: "Caveat", "Bradley Hand", cursive;
        font-style: italic; text-transform: none; color: {NEO_LIME};
        font-weight: 700; }}

      /* ── generic fallback ──────────────────────────────────────────── */
      .generic-text {{ position: relative; width: 80%; text-align: center;
        font-size: 64px; font-weight: 700; color: {SILVER_PALE}; }}

      /* ── captions (cardless; current word lime) ────────────────────── */
      .cap-line {{ position: absolute; left: 0; right: 0; bottom: 8%;
        text-align: center; padding: 0 8%;
        font-size: 46px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px;
        text-shadow: 0 3px 14px rgba(0,0,0,0.9), 0 1px 4px rgba(0,0,0,0.95); }}
      .cap-emph {{ font-size: 64px; bottom: 44%; }}
      .cap-word {{ color: {SILVER_PALE}; }}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="{comp_id}"
      data-start="0"
      data-duration="{duration}"
      data-width="{W}"
      data-height="{H}"
    >
      <!-- Speaker / background layer. Drop the source video or a still here:
             <video id="speaker-media" src="assets/source.mp4" muted playsinline></video>
           The global zoom punch-ins scale #speaker. Left empty = raisin
           backdrop (text-only / motion-graphics clips). -->
      <div id="speaker" class="clip" data-start="0" data-duration="{duration}" data-track-index="0"></div>

      <!-- ── beats (one block per broll_plan.json entry) ── -->
      {beats_html}

      <!-- ── captions ── -->
      {captions_html}
    </div>

    <script>
{timeline_js}
    </script>
  </body>
</html>
"""

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project_dir", help="Hyperframes project dir with broll_plan.json + assets/")
    ap.add_argument("--id", default=None, help="composition id (default: basename of project_dir)")
    ap.add_argument("--resolution", default="square",
                    choices=list(RESOLUTIONS), help="default square (1080x1080)")
    ap.add_argument("--duration", type=float, default=None,
                    help="composition seconds (default: auto from plan)")
    ap.add_argument("-o", "--output", default=None,
                    help="output html path (default: <project_dir>/index.html)")
    args = ap.parse_args()

    project_dir = Path(args.project_dir).expanduser().resolve()
    if not project_dir.is_dir():
        sys.exit(f"error: not a directory: {project_dir}")

    comp_id = args.id or project_dir.name
    html = compile_plan(project_dir, comp_id, args.resolution, args.duration)

    out = Path(args.output).expanduser() if args.output else project_dir / "index.html"
    out.write_text(html)
    print(f"  wrote -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
