# Website hosting — Tigris CDN + Fly apex door

How we host static sites: **content served directly from a Tigris bucket (global edge, free
egress); a tiny Fly app acts only as the apex "door" that 301-redirects to it.** This doc is
the contract every piece must honor — the static-site generator (SSG), the Tigris bucket, the
Fly door, and DNS.

Reference deployment (the `next` test channel):
- **`next.aven.ceo`** → Fly door app `next-aven-ceo` (redirects only)
- **`www.next.aven.ceo`** → Tigris bucket `dark-wind-6797` (serves all content, free egress)

## Files (everything lives in `skills/website/`)

| File | Purpose |
|---|---|
| `deploy.ts` | Builds the site + uploads it via the universal **storagesdk.dev** API (`@storagesdk/core`). Backend-agnostic — swap the adapter to target S3/R2/GCS/etc. **Auto-snapshots** each live deploy (Tigris-native, zero-copy) and prunes to `SNAPSHOT_KEEP` (default 10; `=0` disables). `FORK=<name> bun deploy.ts` deploys into an isolated fork sandbox (seeded from a snapshot). |
| `edge/` | The Fly apex door (`index.ts` Bun redirect app + `Dockerfile` + `fly.toml`). |
| `package.json` | Deploy deps: `@storagesdk/core`, `@storagesdk/adapters`, `@tigrisdata/storage` (the adapter's native peer). |
| `README.md` | This contract. |

Storage access goes through **storagesdk.dev** (not raw boto3/S3 SDK) so we keep one
API across backends and get snapshots/forks as primitives.

---

## 1. The architecture & the law

```
user types next.aven.ceo/…              user shares www.next.aven.ceo/en/…
         │                                          │
         ▼                                          ▼
   Fly door (next-aven-ceo)                 Tigris bucket (dark-wind-6797)
   - 301/302 redirect ONLY                   - serves every byte from the edge
   - never proxies content                   - FREE egress, globally distributed
         │  301 → www.next.aven.ceo/<path>          ▲
         └──────────────────────────────────────────┘
```

**The one-host law — you get 2 of 3:** *single clean host* · *working bare-root redirect* ·
*free Tigris egress*. A hostname resolves to exactly one endpoint, and DNS can never route by
URL path (it runs before HTTP exists). So we **split roles across two hostnames**:

| Host | Role | Bare root `/` | Egress |
|---|---|---|---|
| `next.aven.ceo` (apex/door) | Fly app, redirects only | `302 → /en/` (works) | weightless (redirects only ≈ $0) |
| `www.next.aven.ceo` (content) | Tigris-direct | `403` (harmless, see §6) | **free** (Tigris edge) |

Why a door at all: Tigris cannot serve or redirect its bare root (the empty key → 403), and
DNS cannot issue an HTTP redirect. Redirecting `/` is an HTTP act, so it needs a responder.
The door is the *minimal* such responder and it stays out of the content path.

---

## 2. What the SSG must produce

Tigris does **no index resolution and no redirects** — the URL path *is* the object key,
verbatim. So the build output must be shaped for that:

1. **Pages → slash-keys.** A page at `/en/abc-xyz/` must be stored under the key
   `en/abc-xyz/` (key literally ends in `/`). The home page for a locale is the key `en/`.
   - `GET /en/abc-xyz/` → key `en/abc-xyz/` → 200 ✅
   - `GET /en/abc-xyz`  → key `en/abc-xyz`  → 404 ❌ (different key — trailing slash is load-bearing)
2. **No-slash safety stubs.** For every page also emit the no-slash key (`en/abc-xyz`) as a
   tiny stub: `<meta name="robots" content="noindex">` + `<link rel=canonical>` to the slash
   URL + meta-refresh/JS redirect to it. (Pure-Tigris can't 301, so this is the fallback.)
3. **`index.html` keys are optional** (kept for proxy-mode fallback). Not needed for the
   door+Tigris-direct model.
4. **Assets → content-hash filenames** (`/en/assets/app.<hash>.css`). Immutable, cache forever.
   Pages use **stable** keys (short id or slug) — never a content hash (a content hash changes
   on edit → breaks URL permanence → bad SEO).
5. **Per-page SEO tags** (see §6): `rel=canonical` → the `www` slash-URL, `hreflang` for every
   locale + `x-default`.
6. **Site files at the bucket root:** `robots.txt` (with `Sitemap:` line) and `sitemap.xml`
   (listing every `www.<host>/<locale>/<path>` URL). These are named keys → Tigris serves them.
7. **`404.html`** at the root (cosmetic; Tigris has no custom-error wiring, but the door/other
   tooling can reference it).
8. **Locale layout:** everything lives under a locale prefix — `en/…`, `de/…`. The locale
   home is `en/` (served at `/en/`).

Deploy = `bun skills/website/deploy.ts` — it builds these keys and uploads them via the
universal **storagesdk.dev** API (`storage.upload(key, body, { contentType, cacheControl })`),
backend-agnostic. Updating a page = overwrite its stable key (URL stays stable). For
atomic/rollback-able deploys, use the SDK's **snapshots/forks** (Tigris-native): snapshot the
live state, deploy into a **fork**, verify, then promote — an "IPNS-at-deploy-time" pointer-flip
— but never put the hash in the public URL. (Tigris caveat: a fork must be seeded from a
*snapshot* — `storage.snapshots.create()` first, then `storage.forks.create({ fromSnapshot })`.)

---

## 3. Tigris bucket requirements

- **Public:** `fly storage update <bucket> --public` (objects served at `<bucket>.t3.tigrisfiles.io`).
- **Custom domain = the content host** (`www.next.aven.ceo`). ⚠️ **Fly-managed buckets must be
  configured via Fly, not the Tigris console**, and the CNAME target differs (see §5).
- **Caching:** Tigris honors per-object `Cache-Control`; defaults public static assets to
  `max-age=3600`. **No purge API** — overwrites propagate via replication (sub-second typical),
  but a previously-cached object can serve stale up to its TTL. ⇒ never overwrite a stable URL
  and expect an instant change; use content-hash filenames for anything that must bust caches.
- **Tier:** Standard (never Archive — `GET` on Archive returns 403 until restored).

---

## 4. Fly door requirements

The door (`skills/website/edge/`) is a ~40-line Bun app. Rules:

```
/                      → 302 → CONTENT/<locale>/   (locale from Accept-Language; varies ⇒ 302)
/en /de /en/* /de/*    → 301 → CONTENT + same path  (verbatim host-swap mirror ⇒ 301)
/<locale-less path>    → 301 → CONTENT/en/<path>    (safety fallback)
/healthz               → 200
```

- **Never proxies content** — redirects only, so egress stays weightless.
- **301 for permanent mirrors, 302 for the language-negotiated bare root** (it varies by
  `Accept-Language`).
- **Single hop** — redirect straight to the final `www` URL, no chains.
- **Locale-safe path handling** — if the path already starts with a known locale, mirror it
  verbatim (never double-prefix → no `/en/en/…`); otherwise prepend the default locale.
- **Scale-to-zero:** `auto_stop_machines = "stop"`, `min_machines_running = 0` → ~$0 compute idle.
- **TLS:** Fly issues the cert for the door host via `fly certs add <host>`.

Deploy:
```bash
export FLY_API_TOKEN=$(grep -E '^access_token:' ~/.fly/config.yml | sed -E 's/access_token: *//' | tr -d '"'"'"' \r')
fly deploy skills/website/edge --remote-only --ha=false
```

---

## 5. DNS requirements (Hetzner)

| Host | Type | Target | Notes |
|---|---|---|---|
| content `www.next.aven.ceo` | CNAME | `dark-wind-6797.fly.storage.tigris.dev.` | ⚠️ **Fly-managed bucket → `.fly.storage.tigris.dev`, NOT the Tigris console's `.t3.tigrisbucket.io`** |
| door (subdomain) `next.aven.ceo` | CNAME | `next-aven-ceo.fly.dev.` | the Fly app |
| door (real apex, e.g. `aven.ceo`) | A / AAAA | Fly app's shared-v4 + dedicated-v6 | apex can't be a CNAME |

Rules:
- **Trailing dot** on CNAME values (Hetzner is BIND-style; without it the zone gets appended).
- **DNS-only** — no TLS-terminating proxy (e.g. Cloudflare orange-cloud) in front of a Tigris
  custom domain; it breaks Tigris's cert issuance.
- **Set TTL low (300) BEFORE changing a target.** Changing a CNAME leaves the OLD value cached
  up to its TTL (default 3600) in public resolvers AND in macOS `mDNSResponder` — this causes
  long "cert won't issue / site 000s" stalls and is the #1 gotcha here. Flush a Mac with
  `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`.
- After a clean CNAME, Fly/Tigris auto-issues the cert (minutes). Verify: `fly certs check <host>`.

---

## 6. SEO rules

- **Canonical host = `www`** (apex 301s to it). Be consistent: every `rel=canonical`, sitemap
  entry, and internal link uses `www.<host>/<locale>/<path>`.
- **Apex mirrors all routes via 301** — `aven.ceo/X → 301 → www/en/X`. This is good, not
  harmful: 301s aren't indexed as duplicates, and any apex backlink is rescued. (302 only for
  the language-varying bare apex.)
- **`hreflang`** on every page (each locale + `x-default` → `en`) so Googlebot (crawls as
  US/English, so the auto-redirect always sends *it* to `/en/`) still discovers `/de/`.
- **`sitemap.xml`** lists every locale URL; **`robots.txt`** references it. Both are named keys
  Tigris serves at 200.
- **The content host's bare root `/` → 403 is harmless** *provided* the four signals above are
  in place: Google treats 4xx as "not indexed" (and there's no crawl-rate penalty — verified
  against Google's HTTP-status docs), the bare root is unadvertised and unlinked, and the real
  homepage `/<locale>/` is 200 + canonical. Without those signals it flips to harmful (Google
  can't find a homepage). The textbook-perfect version is a `301` at the content root, which
  would require a responder in the content path (defeats free egress) — so we accept the 403.
- **URLs: stable > pretty.** Short stable ids (`/en/abc-xyz/`) rank essentially the same as
  readable slugs (keyword-in-URL is a tiny factor); readable mainly helps human CTR/sharing.
  **Never** content-hash a *page* URL (changes on edit → breaks permanence).

---

## 7. Egress model

- **Content (HTML, CSS, JS, images, video):** served direct from Tigris → **free egress,
  globally edge-distributed.**
- **Door:** emits only ~300-byte redirects → Fly egress ≈ $0 even at millions of hits;
  scale-to-zero compute ≈ $0 idle.
- **Anti-pattern:** routing content *through* the Fly app (proxy mode) — that bottlenecks
  Tigris's global edge to one Fly region and pays Fly egress on every byte. The door model
  exists specifically to avoid this. If you ever must proxy on one host, at least 302 heavy
  assets to the Tigris public domain so only HTML transits Fly.

---

## 8. Go-live checklist

1. Build + upload (storagesdk registry — backend chosen at runtime):
   ```bash
   TIGRIS_BUCKET=dark-wind-6797 \
   TIGRIS_ACCESS_KEY_ID=… TIGRIS_SECRET_ACCESS_KEY=… \
   TIGRIS_ENDPOINT=https://fly.storage.tigris.dev \
   bun skills/website/deploy.ts
   ```
   Switch backends with `STORAGE_ADAPTER=r2` (or `s3`, `gcs`, …) + that provider's env vars
   (`getAdapterEnvVars(name)` lists them) — **no code change**. `FORK=<name>` deploys into a
   fork sandbox instead of live.
2. `fly storage update <bucket> --public --custom-domain www.<host>`.
3. Hetzner: `www.<host>` CNAME → `<bucket>.fly.storage.tigris.dev.` (TTL 300, DNS-only).
4. Wait for Tigris cert (`fly certs check` / curl `https://www.<host>/<locale>/` → 200).
5. `fly deploy skills/website/edge --ha=false` (door) and point the apex/door host at the Fly app
   (subdomain → CNAME `next-aven-ceo.fly.dev.`; real apex → A/AAAA).
6. `fly certs add <door-host>` and confirm.
7. Verify: door `/` → 302 → `www/<locale>/`; `www/<locale>/…` → 200 from Tigris;
   `www/` → 403 (expected); `robots.txt`/`sitemap.xml` → 200.

---

## 9. Gotchas (hard-won)

- **Fly-managed bucket ⇒ Fly CNAME target** (`.fly.storage.tigris.dev`). The Tigris console
  shows `.t3.tigrisbucket.io` and will report *"Failed to verify CNAME"* for a Fly-managed
  bucket — use Fly's tooling/target instead.
- **CNAME-change cache stalls:** old target lingers up to TTL in resolvers + macOS cache →
  "site 000s / cert stuck". Lower TTL first; flush local DNS to test.
- **Trailing slash is load-bearing** on Tigris-direct (`/x/` ≠ `/x`). Always link with the
  slash; ship no-slash stubs.
- **No cache purge** on Tigris — content-hash anything that must update instantly.
- **Bare content root 403 is by design** — don't try to "fix" it by proxying (kills the edge);
  rely on the SEO signals in §6.
- **Fly app name ≠ domain.** App names must be DNS labels (no dots), so the door app is
  `next-aven-ceo` (dots→hyphens convention: `next.aven.ceo` → `next-aven-ceo`), not
  `next.aven.ceo`. The domain reaches it via `CNAME → <app>.fly.dev`. Renaming a Fly app means
  recreate + move cert/IPs + repoint DNS — not an in-place change.
- **Storage = storagesdk.dev, not raw boto3/aws-sdk.** Use `buildAdapter(name)` (runtime) or the
  `tigris({…})` subpath import (build-time). The native S3 SDK is only a transitive peer under
  the adapter — never import it directly.
