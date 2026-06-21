<script lang="ts">
import type { StorageItemMeta } from '@storagesdk/core'
// Website composer vibe: edit a spark's files locally and preview securely.
//
// Storage goes through the SAME universal `Storage` API as the Tigris deploy — here backed by the
// `tauriFs` adapter (scoped Tauri fs IPC). Preview renders in a sandboxed, opaque-origin iframe
// (no allow-same-origin) so the site's JS can never reach the app or Tauri IPC. A tab switcher
// flips between the live Preview and the Code view (file list + editor). board 0055.
import { Storage } from '@storagesdk/core'
import { sparksList } from '$lib/composer/spark-ipc'
import { tauriFs } from '$lib/composer/tauri-fs-adapter'

type Tab = 'preview' | 'code'
let tab = $state<Tab>('preview')

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
