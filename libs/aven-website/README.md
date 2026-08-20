# aven-website — the avenCEO marketing site

The public site: landing, skills marketplace (`/skills`, per publisher and
slug), pricing, waitlist. Recovered from history (it was stripped in board
0121 "strip avenOS to the avenCITY seed") because the content — the avenCEO
positioning and the seven skill pages — is worth keeping alive.

## Running it

A dev server of its own, deliberately: the Tauri app ships no server at all,
and the two must never share a port.

```bash
bun run dev:website     # http://localhost:1421
```

The app is unaffected and keeps 1420 (`bun run dev:app`), so both can run
side by side. Nothing here is bundled into the app.

## Notes

- Content lives as JSON in `src/lib/skills/content/{de,en}` with publisher
  profiles in `src/lib/skills/publishers/{de,en}`; adding a skill is adding
  two JSON files.
- `/api/waitlist` posts to `WAITLIST_WEBHOOK_URL` (root `.env`) when set and
  is a no-op otherwise, so local runs need no secrets.
- Brand spelling is `avenCEO` — lowercase `aven`, like `avenOS`.
