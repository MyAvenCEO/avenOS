<script lang="ts">
import type { StorageItemMeta } from '@storagesdk/core'
// Website composer: edit a spark's files locally and preview securely.
//
// Storage goes through the SAME universal `Storage` API as the Tigris deploy —
// here backed by the `tauriFs` adapter (scoped Tauri fs IPC). Preview renders in
// a sandboxed, opaque-origin iframe (no allow-same-origin) so the site's JS can
// never reach the app or Tauri IPC.
import { Storage } from '@storagesdk/core'
import { sparksList } from '$lib/composer/spark-ipc'
import { tauriFs } from '$lib/composer/tauri-fs-adapter'

let sparks = $state<string[]>([])
let sparkId = $state('')
let files = $state<StorageItemMeta[]>([])
let openPath = $state('index.html')
let content = $state('')
let previewHtml = $state('')
let status = $state('')

const storage = $derived(sparkId ? new Storage({ adapter: tauriFs({ sparkId }) }) : null)
const dec = new TextDecoder()

async function loadFiles() {
	if (!storage) return
	files = (await storage.list()).items
}
async function openFile(path: string) {
	if (!storage) return
	openPath = path
	content = dec.decode((await storage.download(path)).body)
	// index.html mirrors the live buffer (see the $effect below); for any other file, show the
	// current index.html from storage so the preview still reflects the site.
	if (path !== 'index.html') await loadIndexPreview()
}
// Pull index.html from storage into the preview — used when editing a non-index file.
async function loadIndexPreview() {
	if (!storage) return
	try {
		previewHtml = dec.decode((await storage.download('index.html')).body)
	} catch {
		previewHtml = '' // spark has no index.html yet
	}
}
async function save() {
	if (!storage) return
	status = 'saving…'
	await storage.upload(openPath, content, { contentType: 'text/html; charset=utf-8' })
	status = 'saved ✓'
	await loadFiles()
	if (openPath !== 'index.html') await loadIndexPreview()
	setTimeout(() => (status = ''), 1500)
}

// Live preview: while editing index.html, mirror the buffer into the iframe on every edit (and
// therefore on save too). `srcdoc` re-renders whenever this string changes — no blob URL, so the
// sandboxed opaque-origin iframe loads it reliably.
$effect(() => {
	if (openPath === 'index.html') previewHtml = content
})

// load spark list once
$effect(() => {
	void (async () => {
		const list = await sparksList()
		sparks = list
		if (!sparkId && list.length) sparkId = list[0]
	})()
})

// on spark change: load files + open index.html + preview
let lastSpark = ''
$effect(() => {
	if (sparkId && sparkId !== lastSpark) {
		lastSpark = sparkId
		void (async () => {
			await loadFiles()
			try {
				await openFile('index.html')
			} catch {
				content = ''
				openPath = 'index.html'
			}
		})()
	}
})
</script>

<div class="flex h-full min-h-0 flex-col bg-[#060f1f] text-[#F4EFE6]">
	<header class="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-sm">
		<span class="font-semibold">Composer</span>
		<select
			bind:value={sparkId}
			class="rounded border border-white/15 bg-[#0b1426] px-2 py-1 text-xs"
		>
			{#each sparks as s (s)}
				<option value={s}>{s}</option>
			{/each}
		</select>
		<span class="text-white/40">editing <b class="text-[#cfe0ff]">{openPath}</b></span>
		<button
			onclick={save}
			class="rounded border border-[#7aa2ff]/40 bg-[#7aa2ff]/10 px-3 py-1 text-xs text-[#cfe0ff] hover:bg-[#7aa2ff]/20"
		>
			Save
		</button>
		<span class="text-xs text-emerald-400">{status}</span>
		<span
			class="ml-auto rounded-full border border-[#7aa2ff]/40 bg-[#7aa2ff]/10 px-2 py-0.5 text-[11px] text-[#cfe0ff]"
			>local fs · sandboxed preview</span
		>
	</header>

	<div class="grid min-h-0 flex-1" style="grid-template-columns: 200px 1fr 1fr;">
		<!-- file list -->
		<ul class="min-h-0 overflow-auto border-r border-white/10 p-2 text-[13px]">
			{#each files as f (f.path)}
				<li>
					<button
						onclick={() => openFile(f.path)}
						class="w-full truncate rounded px-2 py-1 text-left hover:bg-white/5 {f.path === openPath
							? 'bg-white/10 text-[#cfe0ff]'
							: 'text-white/70'}"
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
			class="min-h-0 resize-none border-r border-white/10 bg-[#0b1426] p-4 font-mono text-[13px] leading-relaxed text-[#d7e0f0] outline-none"
		></textarea>

		<!-- sandboxed preview (opaque origin: no app/IPC access); srcdoc re-renders on every edit/save -->
		<iframe
			title="preview"
			srcdoc={previewHtml}
			sandbox="allow-scripts"
			class="min-h-0 bg-white"
		></iframe>
	</div>
</div>
