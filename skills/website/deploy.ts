/**
 * Static-site deploy via the universal storagesdk.dev API (@storagesdk/core).
 *
 * Backend-agnostic: swap the adapter import + config to target S3, R2, GCS, …
 * without touching the build/upload logic. Tigris is the default.
 *
 * Forking: `FORK=<name> bun deploy.ts` deploys into an isolated fork of the
 * bucket (a sandbox) instead of the live site — branch per run, inspect, then
 * `storage.forks.delete(name)` to discard or promote. See skills/website/README.md.
 *
 * Run:
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… bun skills/website/deploy.ts
 *   FORK=preview-42 AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… bun skills/website/deploy.ts
 */
import { Storage } from "@storagesdk/core";
import { buildAdapter, type AdapterName } from "@storagesdk/adapters";

// ── backend selected at RUNTIME via the storagesdk registry ───────────────────
// `STORAGE_ADAPTER` (default "tigris") picks the provider; buildAdapter reads that
// provider's env vars and dynamically imports only its peer SDK. Switch backends
// (s3 / r2 / gcs / …) by changing STORAGE_ADAPTER + that provider's env vars —
// zero code change. tigris reads: TIGRIS_BUCKET, TIGRIS_ACCESS_KEY_ID,
// TIGRIS_SECRET_ACCESS_KEY, TIGRIS_ENDPOINT (optional).
const ADAPTER = (process.env.STORAGE_ADAPTER ?? "tigris") as AdapterName;
const live = new Storage({ adapter: await buildAdapter(ADAPTER) });
const BUCKET = process.env.TIGRIS_BUCKET ?? process.env.S3_BUCKET ?? "(bucket)";

// optional fork sandbox
const FORK = process.env.FORK;
const storage = FORK
  ? await (async () => {
      const forks = await live.forks.list();
      if (!forks.some((f) => f.name === FORK)) await live.forks.create({ name: FORK });
      return live.forks.get(FORK);
    })()
  : live;

// ── site model (HOST is the Tigris-direct content host) ──────────────────────
const HOST = process.env.SITE_HOST ?? "https://www.next.aven.ceo";
const LOCALES = ["en", "de"] as const;
type Loc = (typeof LOCALES)[number];

const T: Record<Loc, Record<string, string>> = {
  en: { home: "Home", about: "About", blog: "Blog",
    lede: "Your operating system for a sovereign life — served from object storage, no servers in the data path.",
    intro: "Static site on a Tigris bucket, deployed via the universal storagesdk.dev API. <code>aven.ceo</code> is the Fly 301 door; <code>www.next.aven.ceo</code> serves every byte direct from Tigris's edge.",
    aboutb: "A sample page under a short stable id <code>/en/abc-xyz/</code>, stored as the slash-key <code>en/abc-xyz/</code> and served directly by Tigris.",
    p1: "Hello, Tigris", p1d: "object storage as a website", p1b: "Served straight from Tigris's global edge with free egress." },
  de: { home: "Start", about: "Über", blog: "Blog",
    lede: "Dein Betriebssystem für ein souveränes Leben — direkt aus dem Object Storage, ohne Server im Pfad.",
    intro: "Statische Seite auf einem Tigris-Bucket, deployed über die universelle storagesdk.dev-API. <code>aven.ceo</code> ist die Fly-301-Tür; <code>www.next.aven.ceo</code> liefert jedes Byte direkt von Tigris.",
    aboutb: "Beispielseite unter kurzer stabiler ID <code>/de/abc-xyz/</code>, gespeichert als Slash-Key <code>de/abc-xyz/</code>.",
    p1: "Hallo, Tigris", p1d: "Object Storage als Website", p1b: "Direkt von Tigris' globalem Edge mit kostenlosem Egress." },
};

const CSS = `*{box-sizing:border-box;margin:0;padding:0}:root{--ink:#0B1F3A;--cream:#F4EFE6;--muted:#9fb1cc;--accent:#7aa2ff}
body{font-family:ui-sans-serif,-apple-system,system-ui,sans-serif;background:radial-gradient(1100px 650px at 50% -12%,#1d3f72,var(--ink) 58%,#060f1f);color:var(--cream);min-height:100vh;line-height:1.6}
.bar{display:flex;gap:1.4rem;align-items:center;justify-content:center;padding:1.2rem;border-bottom:1px solid rgba(244,239,230,.1);position:sticky;top:0;backdrop-filter:blur(8px);background:rgba(6,15,31,.45)}
.bar a{color:var(--muted);text-decoration:none;font-size:.95rem}.bar a:hover,.bar a.on{color:var(--accent)}.bar .brand{color:#fff;font-weight:600}.bar .brand b{color:var(--accent)}.bar .lang{margin-left:auto}
main{max-width:720px;margin:0 auto;padding:3.2rem 1.6rem 5rem}h1{font-size:clamp(2rem,6vw,3.2rem);font-weight:600;letter-spacing:-.03em;background:linear-gradient(180deg,#fff,#cdd9f2);-webkit-background-clip:text;background-clip:text;color:transparent}
p{color:#d7e0f0;margin:1rem 0}.lede{font-size:1.15rem;color:var(--muted)}.card{display:block;text-decoration:none;color:inherit;border:1px solid rgba(122,162,255,.22);border-radius:14px;padding:1.1rem 1.3rem;margin:1rem 0;transition:.2s;background:rgba(122,162,255,.05)}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}.card .t{color:#fff;font-weight:600}.card .d{color:var(--muted);font-size:.9rem}.tag{display:inline-flex;gap:.5rem;align-items:center;margin-bottom:1.3rem;padding:.35rem .85rem;border-radius:999px;background:rgba(122,162,255,.1);border:1px solid rgba(122,162,255,.28);color:#cfe0ff;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}
code{background:rgba(255,255,255,.08);padding:.12rem .4rem;border-radius:6px;color:#cfe0ff}a.back{color:var(--accent);text-decoration:none}.loc{position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:.72rem;color:rgba(159,177,204,.7);padding:.55rem;background:rgba(6,15,31,.6);border-top:1px solid rgba(244,239,230,.08)}.loc b{color:var(--accent)}`;

const head = (loc: Loc, rel: string, title: string) => {
  const alt = LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${HOST}/${l}/${rel}">`).join("") +
    `<link rel="alternate" hreflang="x-default" href="${HOST}/en/${rel}">`;
  return `<!DOCTYPE html><html lang="${loc}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title} · aven.ceo</title><link rel="canonical" href="${HOST}/${loc}/${rel}">${alt}<style>${CSS}</style></head><body>`;
};
const nav = (loc: Loc, active: string) => {
  const t = T[loc], B = `/${loc}`, other = loc === "en" ? "de" : "en";
  const L = (h: string, lbl: string, k: string) => `<a class="${k === active ? "on" : ""}" href="${h}">${lbl}</a>`;
  return `<nav class="bar"><a class="brand" href="${B}/">aven<b>.</b>ceo</a>${L(B + "/", t.home, "home")}${L(B + "/abc-xyz/", t.about, "about")}${L(B + "/blog/", t.blog, "blog")}<a class="lang" href="/${other}/abc-xyz/" hreflang="${other}">${other.toUpperCase()}</a></nav>`;
};
const foot = (loc: Loc) => `<div class="loc">locale <b>${loc}</b> · path <b id="p"></b></div><script>document.getElementById("p").textContent=location.pathname</script></body></html>`;

function pages(loc: Loc): Record<string, string> {
  const t = T[loc], B = `/${loc}`;
  return {
    "": head(loc, "", t.home) + nav(loc, "home") + `<main><span class="tag">next channel · tigris-direct</span><h1>aven.ceo</h1><p class="lede">${t.lede}</p><p>${t.intro}</p><a class="card" href="${B}/abc-xyz/"><div class="t">→ ${t.about}</div><div class="d">/${loc}/abc-xyz/ — short stable id</div></a><a class="card" href="${B}/blog/"><div class="t">→ ${t.blog}</div><div class="d">/${loc}/blog/p1/ — nested</div></a></main>` + foot(loc),
    "abc-xyz/": head(loc, "abc-xyz/", t.about) + nav(loc, "about") + `<main><a class="back" href="${B}/">←</a><h1>${t.about}</h1><p>${t.aboutb}</p></main>` + foot(loc),
    "blog/": head(loc, "blog/", t.blog) + nav(loc, "blog") + `<main><a class="back" href="${B}/">←</a><h1>${t.blog}</h1><a class="card" href="${B}/blog/p1/"><div class="t">${t.p1}</div><div class="d">${t.p1d}</div></a></main>` + foot(loc),
    "blog/p1/": head(loc, "blog/p1/", t.p1) + nav(loc, "blog") + `<main><a class="back" href="${B}/blog/">←</a><h1>${t.p1}</h1><p>${t.p1b}</p></main>` + foot(loc),
  };
}
const stub = (loc: Loc, rel: string) => {
  const dest = `/${loc}/${rel}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${HOST}${dest}"><meta http-equiv="refresh" content="0;url=${dest}"><script>location.replace("${dest}")</script></head><body></body></html>`;
};

// ── build the full key→object map ────────────────────────────────────────────
type Obj = { body: string; contentType: string; cacheControl: string };
const HTML = "text/html; charset=utf-8";
const objs = new Map<string, Obj>();
const sitemap: string[] = [];

for (const loc of LOCALES) {
  for (const [rel, html] of Object.entries(pages(loc))) {
    objs.set(`${loc}/${rel}`, { body: html, contentType: HTML, cacheControl: "public, max-age=300" });            // slash-key (Tigris-direct)
    objs.set(`${loc}/${rel}index.html`, { body: html, contentType: HTML, cacheControl: "public, max-age=300" });  // index.html (fallback)
    objs.set(`${loc}/${rel}`.replace(/\/$/, ""), { body: stub(loc, rel), contentType: HTML, cacheControl: "public, max-age=300" }); // no-slash stub
    sitemap.push(`${HOST}/${loc}/${rel}`);
  }
}
objs.set("404.html", { body: `<!DOCTYPE html><meta charset="utf-8"><title>404</title><body style="font-family:system-ui;background:#060f1f;color:#F4EFE6;display:grid;place-items:center;height:100vh;text-align:center"><div><h1 style="font-size:4rem">404</h1><p><a style="color:#7aa2ff" href="/en/">→ home</a></p></div>`, contentType: HTML, cacheControl: "public, max-age=300" });
objs.set("robots.txt", { body: `User-agent: *\nAllow: /\nSitemap: ${HOST}/sitemap.xml\n`, contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=300" });
objs.set("sitemap.xml", { body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`, contentType: "application/xml; charset=utf-8", cacheControl: "public, max-age=300" });

// ── upload via the universal SDK ─────────────────────────────────────────────
console.log(`deploying ${objs.size} objects → ${FORK ? `fork:${FORK} of ` : ""}bucket:${BUCKET} (${HOST})`);
let n = 0;
for (const [key, o] of objs) {
  await storage.upload(key, o.body, { contentType: o.contentType, cacheControl: o.cacheControl });
  if (++n % 10 === 0 || n === objs.size) console.log(`  ${n}/${objs.size}`);
}

// auto-snapshot each LIVE deploy (Tigris-native, zero-copy) + prune to keep last N.
// Skipped for fork deploys. Disable with SNAPSHOT_KEEP=0.
const KEEP = Number(process.env.SNAPSHOT_KEEP ?? 10);
if (!FORK && KEEP > 0) {
  const snap = await live.snapshots.create({ name: `deploy-${new Date().toISOString()}` });
  console.log(`snapshot: ${snap.id} (${snap.name})`);
  const all = (await live.snapshots.list()).sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  );
  const stale = all.slice(0, Math.max(0, all.length - KEEP));
  for (const old of stale) await live.snapshots.delete(old.id);
  if (stale.length) console.log(`pruned ${stale.length} old snapshot(s); keeping last ${KEEP}`);
}

console.log(`done. ${FORK ? `Fork "${FORK}" ready — inspect, then live.forks.delete("${FORK}") to discard.` : "Live."}`);
