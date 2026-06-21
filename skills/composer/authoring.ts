// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the guide text instructs GLM to write the literal ${BASE_URL} placeholder
// The compact authoring contract injected into the website model's (GLM) system prompt. It tells GLM
// the SOURCE (`src/`) layout it edits and the hard boundary: it authors markdown + components + i18n
// only — the deterministic generator (site-generator.ts) ASSEMBLES `public/` (pages, routing, the
// language switcher, the blog index). The full architecture lives in README.md. board 0056/0057.

export const COMPOSER_AUTHORING_GUIDE =
	'You edit the SOURCE of a locale-routed static website (a real generator assembles + hosts it on ' +
	'Tigris, like next.aven.ceo). You author ONLY files under src/; a deterministic generator builds ' +
	'public/ from them. You NEVER write whole HTML pages, routing, slash-keys, 404/robots/sitemap, the ' +
	'language switcher, or the blog index — the generator owns ALL of that.\n' +
	'src/ layout:\n' +
	'- src/pages/<locale>/<name>.md — a page in MARKDOWN with frontmatter (title, layout). ' +
	'`home.md` is the locale home (served at /<locale>/); `about.md` → /<locale>/about/.\n' +
	'- src/blog/<locale>/<slug>.md — an article in MARKDOWN with frontmatter (title, date, summary, ' +
	'layout: article). The generator builds the blog index automatically from these.\n' +
	'- src/i18n/<locale>.json — UI strings, e.g. {"title":"…","nav":{"home":"…","blog":"…"}}.\n' +
	'- src/components/<name>.html — reusable plain-HTML partials with {{token}} slots (nav, footer, ' +
	'article-card). Reference a partial from a layout with {{> name}}.\n' +
	'- src/layouts/<name>.html — page skeletons: include {{> nav}}/{{> footer}}, place {{content}}, and ' +
	'use {{title}}, {{lang}}, {{t.nav.home}} (i18n), {{lang_switcher}}.\n' +
	'- src/styles.css — ALL styling (light, clean). No inline <style>.\n' +
	'How to make changes:\n' +
	'- ADD a page/article: create a new .md under src/pages/<locale>/ or src/blog/<locale>/ for EACH ' +
	'locale. Keep locales in sync.\n' +
	'- Reword content: edit the .md body or src/i18n/<locale>.json.\n' +
	'- Change the look / nav / footer: edit the component or layout HTML, or styles.css.\n' +
	'- Templates use ONLY {{token}} slots and {{> include}} — never loops/conditionals (the generator ' +
	'does the logic). For an absolute URL use the ${BASE_URL} placeholder (e.g. ' +
	'<link rel="canonical" href="${BASE_URL}{{path}}">).'
