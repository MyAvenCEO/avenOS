<script lang="ts">
// Website composer vibe: edit a spark's files locally and preview securely.
//
// Storage goes through the SAME universal `Storage` API as the Tigris deploy — here backed by the
// `tauriFs` adapter (scoped Tauri fs IPC). The preview is driven by the composer skill's
// deterministic generator (`@avenos/skills/composer`): `buildSite` turns the source files into the
// EXACT Tigris key→object map and `resolveRoute` mimics the edge+Tigris routing, so the sandboxed
// preview iframe NAVIGATES byte-identically to the deployed site (clicking /en/blog/ loads it,
// /→/en/ redirects, bad paths 404). A tab switcher flips between Preview and Code. board 0055/0056.
// Import the PURE generator subpath only — the composer barrel also re-exports the server-only
// GLM editor (edit.ts uses process.env/fetch), which would crash in the browser. board 0056.
import { buildSite, localesOf, resolveRoute } from '@avenos/skills/composer/site-generator'
import type { StorageItemMeta } from '@storagesdk/core'
import { Storage } from '@storagesdk/core'
import { untrack } from 'svelte'
import { get } from 'svelte/store'
import { activeSpark, composerReload, ensureSeeded } from '$lib/composer/active-spark'
import { sparksList } from '$lib/composer/spark-ipc'
import { tauriFs } from '$lib/composer/tauri-fs-adapter'

type Tab = 'preview' | 'code'
let tab = $state<Tab>('preview')

const SRC_HOME = 'src/pages/en/home.md' // the file opened by default in the Code view

let sparks = $state<string[]>([])
let sparkId = $state('')
let files = $state<StorageItemMeta[]>([])
let openPath = $state(SRC_HOME)
let content = $state('')
// The spark's src/ tree (path→content); the generator ASSEMBLES the routed site from this. board 0057.
let source = $state<Record<string, string>>({})
// The preview's current URL — resolved through resolveRoute exactly like the live edge+Tigris.
let currentPath = $state('/en/')
let status = $state('')

const storage = $derived(sparkId ? new Storage({ adapter: tauriFs({ sparkId }) }) : null)
const dec = new TextDecoder()
const TEXT_FILE_RE = /\.(html|css|js|mjs|json|svg|xml|txt|md)$/i

// Preview baseUrl is '' → ${BASE_URL}/en/ resolves to /en/ (root-relative); the nav shim below
// intercepts those clicks and routes them through resolveRoute. Locales are inferred from src so the
// switcher + redirects match the deployed site. board 0056/0057.
const siteLocales = $derived(localesOf(source))
const routeOpts = $derived({
	locales: siteLocales.length ? siteLocales : ['en'],
	defaultLocale: siteLocales.includes('en') ? 'en' : (siteLocales[0] ?? 'en')
})
const siteObjects = $derived(buildSite(source, { baseUrl: '' }))
const siteKeys = $derived(new Set(siteObjects.map((o) => o.key)))
const bodyOf = (key: string): string => siteObjects.find((o) => o.key === key)?.body ?? ''

// srcdoc has no origin so it can't fetch /styles.css — inline it; and inject a click-intercept shim
// that posts navigations up to the parent (which re-resolves them through the same router). The tag
// name is assembled from a variable so no literal closing-script sequence appears anywhere in THIS
// component source (which would end this block early / get unescaped by the formatter).
const SCRIPT = 'script'
const NAV_SHIM =
	`<${SCRIPT}>document.addEventListener("click",function(e){` +
	'var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;' +
	'var h=a.getAttribute("href")||"";' +
	// external links: leave them (the sandbox blocks navigation anyway)
	'if(/^(https?:|mailto:|tel:|data:)/i.test(h))return;' +
	// ALWAYS preventDefault for in-site/placeholder hrefs — a bare "#" would otherwise navigate the
	// srcdoc iframe to a blank about:srcdoc# (the "white screen on click"). Then route real paths only.
	'e.preventDefault();if(!h||h.charAt(0)==="#")return;' +
	`parent.postMessage({__sparkNav:h},"*");});</${SCRIPT}>`
function decorate(html: string): string {
	let out = html
	const css = bodyOf('styles.css')
	if (css.trim()) {
		const style = `<style>\n${css}\n</style>`
		if (/<link[^>]+styles\.css[^>]*>/i.test(out))
			out = out.replace(/<link[^>]+styles\.css[^>]*>/i, style)
		else if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${style}</head>`)
		else out = style + out
	}
	return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${NAV_SHIM}</body>`) : out + NAV_SHIM
}
// Resolve a path through the edge+Tigris router (following redirects) to the body to render.
function renderPath(path: string): string {
	let p = path
	for (let i = 0; i < 6; i++) {
		const r = resolveRoute(p, siteKeys, routeOpts)
		if (r.status === 200) return decorate(bodyOf(r.key))
		if (r.status === 404) return decorate(bodyOf('404.html'))
		p = r.location
	}
	return ''
}
const previewHtml = $derived(renderPath(currentPath))

// Follow redirects to the final path so the address shows the canonical URL (e.g. /en → /en/).
function navigate(path: string): void {
	let p = path
	for (let i = 0; i < 6; i++) {
		const r = resolveRoute(p, siteKeys, routeOpts)
		if (r.status === 200 || r.status === 404) {
			currentPath = p
			return
		}
		p = r.location
	}
	currentPath = p
}
// Resolve a clicked href relative to the current preview path → an absolute site path.
function toAbsolute(href: string): string {
	try {
		const u = new URL(href, `http://preview.local${currentPath}`)
		return u.pathname + u.search
	} catch {
		return href.startsWith('/') ? href : `/${href}`
	}
}
// Receive in-iframe navigations from the nav shim.
$effect(() => {
	function onMsg(e: MessageEvent) {
		const href = (e.data as { __sparkNav?: unknown })?.__sparkNav
		if (typeof href === 'string') navigate(toAbsolute(href))
	}
	window.addEventListener('message', onMsg)
	return () => window.removeEventListener('message', onMsg)
})

async function loadFiles() {
	if (!storage) return
	files = (await storage.list()).items.filter((f) => f.path.startsWith('src/'))
}
async function readFile(path: string): Promise<string> {
	if (!storage) return ''
	try {
		return dec.decode((await storage.download(path)).body)
	} catch {
		return '' // file doesn't exist yet
	}
}
// Load every src/ text file into `source` so the generator can assemble the full routed site.
async function loadSource() {
	if (!storage) return
	const next: Record<string, string> = {}
	for (const it of (await storage.list()).items) {
		if (!it.path.startsWith('src/') || !TEXT_FILE_RE.test(it.path)) continue
		next[it.path] = await readFile(it.path)
	}
	source = next
}
async function openFile(path: string) {
	if (!storage) return
	openPath = path
	content = await readFile(path)
}
async function save() {
	if (!storage) return
	status = 'saving…'
	const ct = openPath.endsWith('.css')
		? 'text/css; charset=utf-8'
		: openPath.endsWith('.js')
			? 'text/javascript; charset=utf-8'
			: 'text/html; charset=utf-8'
	await storage.upload(openPath, content, { contentType: ct })
	status = 'saved ✓'
	await loadFiles()
	source = { ...source, [openPath]: content }
	setTimeout(() => (status = ''), 1500)
}

// Live preview: mirror the open buffer into `source` on every edit so the generated preview tracks
// typing. Read `source` UNTRACKED so writing it back doesn't retrigger this effect. board 0056.
$effect(() => {
	const path = openPath
	const buf = content
	if (TEXT_FILE_RE.test(path)) source = { ...untrack(() => source), [path]: buf }
})

// load spark list once; prefer the shared activeSpark so the chat + Vibes tab act on one spark
$effect(() => {
	void (async () => {
		const list = await sparksList()
		sparks = list
		if (!sparkId && list.length) {
			const preferred = get(activeSpark)
			sparkId = preferred && list.includes(preferred) ? preferred : list[0]
		}
	})()
})

// Publish the selected spark so the chat reads/writes the same one for AI edits.
$effect(() => {
	if (sparkId) activeSpark.set(sparkId)
})

// Re-read from disk when an external edit (the chat's edit_website tool) bumps the reload signal.
let lastReload = get(composerReload)
$effect(() => {
	const tick = $composerReload
	if (tick !== lastReload && sparkId && storage) {
		lastReload = tick
		void (async () => {
			await loadFiles()
			await loadSource()
			await openFile(openPath)
		})()
	}
})

// on spark change: load files + the source map, open the home, reset the preview to /en/
let lastSpark = ''
$effect(() => {
	if (sparkId && sparkId !== lastSpark) {
		lastSpark = sparkId
		void (async () => {
			await ensureSeeded(sparkId)
			await loadFiles()
			await loadSource()
			currentPath = '/en/'
			try {
				await openFile(SRC_HOME)
			} catch {
				content = ''
				openPath = SRC_HOME
			}
		})()
	}
})
</script>

<div class="bg-background text-foreground flex h-full min-h-0 flex-col">
	<header class="border-border flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm">
		<select
			bind:value={sparkId}
			class="border-border bg-card text-foreground rounded-[var(--radius)] border px-2 py-1 text-xs"
		>
			{#each sparks as s (s)}
				<option value={s}>{s}</option>
			{/each}
		</select>

		<!-- Preview | Code tab switcher -->
		<div
			class="border-border bg-card flex gap-0.5 rounded-[var(--radius)] border p-0.5 text-xs font-medium"
		>
			{#each [{ id: 'preview', label: 'Preview' }, { id: 'code', label: 'Code' }] as t (t.id)}
				<button
					type="button"
					class="rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors {tab === t.id
						? 'bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (tab = t.id as Tab)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#if tab === 'code'}
			<span class="text-muted-foreground">editing <b class="text-foreground">{openPath}</b></span>
			<button
				type="button"
				onclick={save}
				class="bg-primary text-primary-foreground rounded-[var(--radius)] px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
			>
				Save
			</button>
			<span class="text-primary text-xs">{status}</span>
		{/if}

		<span
			class="border-border text-muted-foreground ml-auto rounded-full border px-2 py-0.5 text-[11px]"
		>
			local fs · sandboxed preview
		</span>
	</header>

	{#if tab === 'preview'}
		<!-- address bar: shows the resolved route; clicking links in the preview navigates here too -->
		<div
			class="border-border text-muted-foreground flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs"
		>
			<button
				type="button"
				title="Home (/en/)"
				class="hover:text-foreground transition-colors"
				onclick={() => navigate('/')}
			>
				⌂
			</button>
			<span class="bg-card border-border truncate rounded-full border px-3 py-0.5 font-mono">
				{currentPath}
			</span>
		</div>
		<!-- sandboxed preview (opaque origin: no app/IPC access); srcdoc re-renders on every edit/save -->
		<iframe
			title="preview"
			srcdoc={previewHtml}
			sandbox="allow-scripts"
			class="min-h-0 flex-1 border-0 bg-white"
		></iframe>
	{:else}
		<div
			class="grid min-h-0 flex-1"
			style="grid-template-columns: 220px 1fr; grid-template-rows: minmax(0, 1fr);"
		>
			<!-- file list -->
			<ul class="border-border min-h-0 overflow-auto border-r p-2 text-[13px]">
				{#each files as f (f.path)}
					<li>
						<button
							type="button"
							onclick={() => openFile(f.path)}
							class="w-full truncate rounded-[var(--radius)] px-2 py-1 text-left transition-colors {f.path ===
							openPath
								? 'bg-primary/10 text-foreground font-medium'
								: 'text-muted-foreground hover:bg-card'}"
						>
							{f.path}
						</button>
					</li>
				{/each}
			</ul>

			<!-- editor -->
			<textarea
				bind:value={content}
				spellcheck="false"
				class="bg-card text-foreground min-h-0 resize-none p-4 font-mono text-[13px] leading-relaxed outline-none"
			></textarea>
		</div>
	{/if}
</div>
