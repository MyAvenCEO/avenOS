# Editorial principles (engine-agnostic)

Distilled from a larger short-form editing playbook, stripped of any
Remotion / SFX / brand specifics. These govern *what* makes a clip good; the
Hyperframes authoring guide governs *how* to build it. For real-world b-roll,
the skill can pull stock footage from Pexels (see SKILL.md → "Stock b-roll").

## 1. Hook in the first frame

Something meaningful must be on screen within **~0.5s**. The opening frame is
also the thumbnail — it has to promise the payoff, not say "wait for it." Start
your first clip at `data-start: 0`.

## 2. Every visual must be meaningful — no decorative filler

If you can't say in one sentence why an element makes the message clearer, drop
it. Abstract things that merely "feel related" are noise. Prefer, in order:

1. The real thing being talked about (a concrete name, number, or quote).
2. A structured layout when the content enumerates (list, timeline, comparison).
3. Nothing — leave the frame clean rather than padding it.

## 3. Readable caption / text cadence

- A few words per line, not a paragraph. Text must be legible at a glance.
- High contrast against the background (dark scrim behind light text, or vice
  versa).
- One emphasis per beat — color or scale a single key word, not five.
- Hold text long enough to read it twice at speaking speed.

## 4. Motion with intent

- Ease in and out (`power2/3.out`, `sine.inOut`) — never linear for text.
- Subtle scale punches (1.0 → ~1.05) on key moments add energy; cap around 1.15
  or it looks try-hard.
- Avoid a dead static hold — a slow drift or breathing scale keeps a long beat
  alive without distracting.

## 5. Pace and rhythm

- Vary the cadence: don't stack every beat in the first few seconds and leave the
  rest empty.
- For short clips, aim for visual change every few seconds so attention doesn't
  flatline — but only when each change is load-bearing (see #2).

## 6. A deliberate ending — loop or land

End on purpose, never trail off. Pick one:

- **Loop**: the last frame flows back into the first (great for short social loops).
- **Land**: one clear closing line/CTA that lands like a punch.

Forbidden: soft "thanks for watching" energy or a fade to nothing with no point.

## Self-check before reporting done

- [ ] First clip starts at `data-start: 0` and is a real hook.
- [ ] Every element passes the "one sentence why" test.
- [ ] Text is legible: few words, high contrast, held long enough.
- [ ] Motion is eased, not linear; no dead static holds.
- [ ] The ending loops cleanly or lands on a clear beat.
- [ ] `verify.py` reports the expected duration and a real video stream.
