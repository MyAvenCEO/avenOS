// The starter `src/` for a new spark — a concrete BILINGUAL (EN/DE) example that exercises the whole
// SSG: plain-HTML components + layouts, i18n JSON, and markdown pages/articles. `buildSite(SEED_SRC)`
// assembles a full site. The theme is an organic, light "botanical" look (Cormorant Garamond + Inter,
// sage/tan palette, glass-morphism) carried over from a real GLM-edited site. Used BOTH to seed a
// fresh spark (the app writes these files) and as the engine's fixture in tests. board 0057.

const STYLES = `*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#2d3a2e;--head:#2d4a3e;--sage:#5d7c5d;--sage-deep:#3d5a47;--tan:#b8956a;--cream:#faf6ef;--line:rgba(125,154,112,.2);--glass:rgba(255,255,255,.6)}
body{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;color:var(--ink);min-height:100vh;line-height:1.7;background:var(--cream);background-image:radial-gradient(ellipse at top left,rgba(167,196,154,.25),transparent 50%),radial-gradient(ellipse at bottom right,rgba(200,175,130,.18),transparent 50%);background-attachment:fixed}
.top-nav{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;gap:1.6rem;padding:1rem 2rem;background:rgba(250,246,239,.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-nav a{font-size:.85rem;font-weight:500;letter-spacing:.05em;color:var(--sage);text-decoration:none;transition:color .3s}
.top-nav a:hover,.top-nav a.on{color:var(--head)}
.top-nav .brand{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:600;color:var(--head);margin-right:.4rem}
.top-nav .brand span{color:var(--tan);font-style:italic}
.top-nav .lang{margin-left:auto;display:flex;gap:.6rem;font-size:.72rem;letter-spacing:.12em}
.top-nav .lang a.on{color:var(--tan)}
main{max-width:760px;margin:0 auto;padding:7rem 1.5rem 2rem}
.hero{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative}
.botanical{position:absolute;top:-1rem;opacity:.35;pointer-events:none}
.botanical-left{left:-1rem;animation:sway 8s ease-in-out infinite;transform-origin:bottom right}
.botanical-right{right:-1rem;animation:sway 8s ease-in-out infinite reverse;transform-origin:bottom left;transform:scaleX(-1)}
@keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
.eyebrow{display:inline-flex;align-items:center;gap:.75rem;font-size:.7rem;font-weight:500;letter-spacing:.35em;text-transform:uppercase;color:var(--sage);margin-bottom:2rem;padding:.5rem 1.25rem;background:rgba(255,255,255,.5);border:1px solid rgba(125,154,112,.25);border-radius:100px;backdrop-filter:blur(8px)}
.eyebrow::before,.eyebrow::after{content:'';width:18px;height:1px;background:var(--sage);opacity:.5}
.hero h1{font-family:'Cormorant Garamond',serif;font-size:clamp(3rem,9vw,5.5rem);font-weight:500;line-height:1;letter-spacing:-.02em;color:var(--head);margin-bottom:1.2rem}
.hero h1 .accent{font-style:italic;font-weight:400;background:linear-gradient(135deg,#7c9885,var(--tan));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.tagline{font-family:'Cormorant Garamond',serif;font-size:clamp(1.15rem,2.5vw,1.5rem);font-style:italic;color:#6b7d6a;max-width:480px;margin:0 auto 1.5rem;line-height:1.6}
.lede{font-size:.97rem;font-weight:300;color:#5a6b59;max-width:440px;margin:0 auto;line-height:1.8}
.divider{display:flex;align-items:center;justify-content:center;gap:1rem;margin:1.8rem 0;opacity:.5}
.divider .line{width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--sage),transparent)}
.divider .dot{width:4px;height:4px;background:var(--tan);border-radius:50%}
main h2{font-family:'Cormorant Garamond',serif;color:var(--head);font-weight:500;font-size:2rem;margin:1.8rem 0 .7rem}
main p{margin:1rem 0;color:#4a5a49}
main a{color:var(--sage)}
main strong{color:var(--head)}
main code{background:rgba(125,154,112,.12);padding:.1rem .4rem;border-radius:5px;font-size:.9em}
.section-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,5vw,2.6rem);font-weight:500;color:var(--head);text-align:center;margin-bottom:2.2rem}
.blog-list{display:flex;flex-direction:column;gap:1.4rem}
.blog-card{display:block;text-decoration:none;background:var(--glass);border:1px solid var(--line);border-radius:1rem;padding:1.6rem 1.8rem;backdrop-filter:blur(10px);transition:transform .3s,box-shadow .3s}
.blog-card:hover{transform:translateY(-2px);box-shadow:0 10px 30px -10px rgba(45,74,62,.15)}
.blog-card .t{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:500;color:var(--head)}
.blog-card .d{font-size:.9rem;font-weight:300;color:#5a6b59;margin:.4rem 0 .6rem}
.blog-card time{font-size:.75rem;color:#94a394;letter-spacing:.05em}
article{max-width:680px;margin:0 auto}
article .back{display:inline-block;margin-bottom:1.4rem;color:var(--sage);text-decoration:none;font-size:.85rem;font-weight:500}
article h1{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:clamp(2.4rem,6vw,3.4rem);color:var(--head);margin-bottom:.3rem}
article time{display:block;color:#94a394;font-size:.8rem;margin-bottom:1.5rem}
.foot{text-align:center;color:#94a394;font-size:.75rem;font-weight:300;letter-spacing:.05em;padding:3rem 1.5rem;border-top:1px solid var(--line);margin-top:3rem}
@media(max-width:600px){.botanical{display:none}main{padding-top:6rem}}
`

const BOTANICAL = (side: string) =>
	`<svg class="botanical botanical-${side}" width="110" height="150" viewBox="0 0 120 160" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M60 158 C60 120,30 90,20 50 C18 35,25 20,40 15 C55 10,70 20,72 35 C74 50,65 65,55 70" stroke="#5d7c5d" stroke-width="1.5" fill="rgba(167,196,154,.15)" stroke-linecap="round"/><ellipse cx="35" cy="40" rx="18" ry="8" transform="rotate(-30 35 40)" fill="rgba(167,196,154,.2)" stroke="#5d7c5d" stroke-width="1"/><ellipse cx="50" cy="60" rx="15" ry="7" transform="rotate(-20 50 60)" fill="rgba(167,196,154,.2)" stroke="#5d7c5d" stroke-width="1"/><ellipse cx="78" cy="55" rx="16" ry="7" transform="rotate(25 78 55)" fill="rgba(184,149,106,.15)" stroke="#b8956a" stroke-width="1"/></svg>`

const NAV = `<nav class="top-nav">
\t<a class="brand" href="/{{lang}}/">aven<span>.ceo</span></a>
\t<a href="/{{lang}}/">{{t.nav.home}}</a>
\t<a href="/{{lang}}/blog/">{{t.nav.blog}}</a>
\t<a href="/{{lang}}/about/">{{t.nav.about}}</a>
\t<span class="lang">{{lang_switcher}}</span>
</nav>
`

const FOOTER = `<footer class="foot">© aven.ceo · crafted with the composer</footer>
`

const ARTICLE_CARD = `<a class="blog-card" href="{{url}}">
\t<div class="t">{{title}}</div>
\t<div class="d">{{summary}}</div>
\t<time>{{date}}</time>
</a>
`

const HEAD = `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{title}} · {{t.title}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<link rel="canonical" href="\${BASE_URL}{{path}}">
</head>`

const PAGE_LAYOUT = `<!doctype html>
<html lang="{{lang}}">
${HEAD}
<body>
{{> nav}}
<main>{{content}}</main>
{{> footer}}
</body>
</html>
`

const ARTICLE_LAYOUT = `<!doctype html>
<html lang="{{lang}}">
${HEAD}
<body>
{{> nav}}
<main>
<article>
<a class="back" href="/{{lang}}/blog/">← {{t.nav.blog}}</a>
<h1>{{title}}</h1>
<time>{{date}}</time>
{{content}}
</article>
</main>
{{> footer}}
</body>
</html>
`

const HOME_EN = `---
title: Home
layout: page
---

<section class="hero">
${BOTANICAL('left')}
${BOTANICAL('right')}
<span class="eyebrow">Composer · Static Site</span>
<h1>aven<span class="accent">.ceo</span></h1>
<p class="tagline">A calm, hand-crafted home on the open web.</p>
<div class="divider"><span class="line"></span><span class="dot"></span><span class="line"></span></div>
<p class="lede">Written in markdown and assembled by the composer's static-site generator, then served from the edge. Edit <code>src/pages/en/home.md</code> to make it yours.</p>
</section>
`

const HOME_DE = `---
title: Start
layout: page
---

<section class="hero">
${BOTANICAL('left')}
${BOTANICAL('right')}
<span class="eyebrow">Composer · Statische Seite</span>
<h1>aven<span class="accent">.ceo</span></h1>
<p class="tagline">Ein ruhiges, handgemachtes Zuhause im offenen Web.</p>
<div class="divider"><span class="line"></span><span class="dot"></span><span class="line"></span></div>
<p class="lede">In Markdown geschrieben und vom Generator des Composers zusammengesetzt. Bearbeite <code>src/pages/de/home.md</code>, um es dir zu eigen zu machen.</p>
</section>
`

const ABOUT_EN = `---
title: About
layout: page
---

## About

aven.ceo is a small, calm corner of the open web — built with the composer and served straight from the edge.

This page is \`src/pages/en/about.md\`. Write in **markdown**; the generator handles the layout, the navigation, and both languages.
`

const ABOUT_DE = `---
title: Über
layout: page
---

## Über

aven.ceo ist eine kleine, ruhige Ecke im offenen Web — mit dem Composer gebaut und direkt vom Edge ausgeliefert.

Diese Seite ist \`src/pages/de/about.md\`. Schreibe in **Markdown**; den Rest übernimmt der Generator.
`

const POST_EN = `---
title: The Founder's Compass
date: 2026-06-15
summary: How to navigate uncertainty and stay true to your vision.
layout: article
---

When the path forward isn't clear, the **compass** still points home.

A founder's job is to hold the direction while the map keeps changing — to keep walking toward the thing that mattered before the noise arrived.
`

const POST_DE = `---
title: Der Kompass des Gründers
date: 2026-06-15
summary: Wie man Unsicherheit navigiert und der Vision treu bleibt.
layout: article
---

Wenn der Weg nicht klar ist, zeigt der **Kompass** trotzdem nach Hause.

Die Aufgabe eines Gründers ist es, die Richtung zu halten, während sich die Karte ständig ändert.
`

/** A fresh spark's source tree (path → content). buildSite(SEED_SRC) → the deployable site. */
export const SEED_SRC: Record<string, string> = {
	'src/styles.css': STYLES,
	'src/components/nav.html': NAV,
	'src/components/footer.html': FOOTER,
	'src/components/article-card.html': ARTICLE_CARD,
	'src/layouts/page.html': PAGE_LAYOUT,
	'src/layouts/article.html': ARTICLE_LAYOUT,
	'src/i18n/en.json': JSON.stringify(
		{ title: 'aven.ceo', nav: { home: 'Home', blog: 'Blog', about: 'About' } },
		null,
		2
	),
	'src/i18n/de.json': JSON.stringify(
		{ title: 'aven.ceo', nav: { home: 'Start', blog: 'Blog', about: 'Über' } },
		null,
		2
	),
	'src/pages/en/home.md': HOME_EN,
	'src/pages/de/home.md': HOME_DE,
	'src/pages/en/about.md': ABOUT_EN,
	'src/pages/de/about.md': ABOUT_DE,
	'src/blog/en/founders-compass.md': POST_EN,
	'src/blog/de/founders-compass.md': POST_DE
}
