<script lang="ts">
import { onMount } from 'svelte'
import type { Action } from 'svelte/action'
import { normalizeWikilinkPath, renderVaultMarkdown } from '$lib/memory/markdown-view'
import { workspaceContentClass } from '$lib/workspace/layout'

type NoteSummary = { path: string; title: string }

let notes = $state<NoteSummary[]>([])
let filter = $state('')
let selectedPath = $state<string | null>(null)
let editorContent = $state('')
let loadError = $state<string | null>(null)
let saveError = $state<string | null>(null)
let loadingList = $state(true)
let loadingNote = $state(false)
let saving = $state(false)
/** Same Markdown table Maia gets under "Vault snapshot" (built from `.data/knowledge`, not a separate index file). */
let vaultSnapshotMarkdown = $state('')
let vaultSnapshotIso = $state<string | null>(null)
let vaultSnapshotMeta = $state<string | null>(null)
/** Default: readable preview (Obsidian-style); switch to Markdown to edit raw source. */
let viewMode = $state<'display' | 'markdown'>('display')

const origin =
	typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''

/** Sentinel path — not a real vault file; opens live Path|Title snapshot in the panel. */
const VAULT_INDEX_PATH = '__aven_vault_index__'

/** Maia runtime Markdown under `.data/agents/maia` — loaded via `/api/memory/maia-doc`. */
type MaiaDocKind = 'soul' | 'rules' | 'readme'
const MAIA_DOC_PREFIX = '__aven_maia__/'
const MAIA_DOC_ROWS: readonly { kind: MaiaDocKind; file: string; hint: string }[] = [
	{ kind: 'soul', file: 'SOUL.md', hint: 'Identity' },
	{ kind: 'rules', file: 'RULES.md', hint: 'Procedures' },
	{ kind: 'readme', file: 'README.md', hint: 'Folder reference' }
]

function maiaSentinelPath(kind: MaiaDocKind): string {
	return `${MAIA_DOC_PREFIX}${kind}`
}

function parseMaiaDocKind(path: string | null): MaiaDocKind | null {
	if (!path?.startsWith(MAIA_DOC_PREFIX)) return null
	const k = path.slice(MAIA_DOC_PREFIX.length)
	return k === 'soul' || k === 'rules' || k === 'readme' ? k : null
}

function diskPathForMaiaKind(kind: MaiaDocKind): string {
	const file = MAIA_DOC_ROWS.find((r) => r.kind === kind)?.file ?? `${kind}.md`
	return `.data/agents/maia/${file}`
}

async function loadMaiaDocContent(kind: MaiaDocKind): Promise<string> {
	const res = await fetch(`${origin}/api/memory/maia-doc?kind=${kind}`)
	const data: unknown = await res.json().catch(() => null)
	const body =
		data !== null && typeof data === 'object' && !Array.isArray(data)
			? (data as { ok?: unknown; content?: unknown })
			: null
	if (
		!res.ok ||
		body === null ||
		body.ok !== true ||
		typeof body.content !== 'string'
	) {
		const err =
			body && typeof body === 'object' && 'error' in body
				? (body as { error: unknown }).error
				: undefined
		const msg =
			typeof err === 'string' ? err : `Maia doc load failed (${res.status})`
		throw new Error(msg)
	}
	return body.content
}

const previewHtml = $derived(viewMode === 'display' ? renderVaultMarkdown(editorContent) : '')

const vaultIndexPanelHtml = $derived(
	vaultSnapshotMarkdown.trim() ? renderVaultMarkdown(vaultSnapshotMarkdown) : ''
)

/** Main panel HTML in Display mode (vault index uses live snapshot, not editor buffer). */
const displayPanelHtml = $derived(
	viewMode === 'display'
		? selectedPath === VAULT_INDEX_PATH
			? vaultIndexPanelHtml
			: previewHtml
		: ''
)

const isVaultIndexSelected = $derived(selectedPath === VAULT_INDEX_PATH)
const selectedMaiaKind = $derived(parseMaiaDocKind(selectedPath))

const filtered = $derived(
	(notes ?? []).filter(
		(n) =>
			!filter.trim() ||
			n.path.toLowerCase().includes(filter.toLowerCase()) ||
			n.title.toLowerCase().includes(filter.toLowerCase())
	)
)

async function refreshList() {
	loadError = null
	loadingList = true
	try {
		const res = await fetch(`${origin}/api/memory/notes`)
		const data: unknown = await res.json().catch(() => null)
		if (
			!res.ok ||
			data === null ||
			typeof data !== 'object' ||
			!('ok' in data) ||
			!(data as { ok?: boolean }).ok
		) {
			const msg =
				data !== null &&
				typeof data === 'object' &&
				'error' in data &&
				typeof (data as { error: unknown }).error === 'string'
					? (data as { error: string }).error
					: `List failed (${res.status})`
			throw new Error(msg)
		}
		const list = (data as { notes?: NoteSummary[] }).notes
		notes = Array.isArray(list) ? list : []
		const vs = (
			data as {
				vaultSnapshot?: {
					markdown?: string
					generatedIso?: string
					noteCount?: number
					tableMarkdownChars?: number
				}
			}
		).vaultSnapshot
		if (vs && typeof vs.markdown === 'string') {
			vaultSnapshotMarkdown = vs.markdown
			vaultSnapshotIso = typeof vs.generatedIso === 'string' ? vs.generatedIso : null
			const n = typeof vs.noteCount === 'number' ? vs.noteCount : notes.length
			const c = typeof vs.tableMarkdownChars === 'number' ? vs.tableMarkdownChars : 0
			vaultSnapshotMeta = `${n} path(s) · ${c.toLocaleString()} chars in table body`
		} else {
			vaultSnapshotMarkdown = ''
			vaultSnapshotIso = null
			vaultSnapshotMeta = null
		}
		const maiaKind = parseMaiaDocKind(selectedPath)
		if (selectedPath === VAULT_INDEX_PATH) {
			editorContent = vaultSnapshotMarkdown
		} else if (maiaKind) {
			try {
				editorContent = await loadMaiaDocContent(maiaKind)
				saveError = null
			} catch (e) {
				saveError = e instanceof Error ? e.message : String(e)
			}
		}
	} catch (e) {
		loadError = e instanceof Error ? e.message : String(e)
		notes = []
	} finally {
		loadingList = false
	}
}

function openVaultIndex() {
	saveError = null
	loadingNote = false
	selectedPath = VAULT_INDEX_PATH
	editorContent = vaultSnapshotMarkdown
	viewMode = 'display'
}

async function openMaiaDoc(kind: MaiaDocKind) {
	saveError = null
	loadingNote = true
	selectedPath = maiaSentinelPath(kind)
	viewMode = 'display'
	try {
		editorContent = await loadMaiaDocContent(kind)
	} catch (e) {
		editorContent = ''
		saveError = e instanceof Error ? e.message : String(e)
	} finally {
		loadingNote = false
	}
}

async function openNote(path: string) {
	saveError = null
	loadingNote = true
	selectedPath = path
	try {
		const qs = new URLSearchParams({ path })
		const res = await fetch(`${origin}/api/memory/note?${qs}`)
		const data: unknown = await res.json().catch(() => null)
		if (
			!res.ok ||
			data === null ||
			typeof data !== 'object' ||
			!('ok' in data) ||
			!(data as { ok?: boolean }).ok
		) {
			const msg =
				data !== null &&
				typeof data === 'object' &&
				'error' in data &&
				typeof (data as { error: unknown }).error === 'string'
					? (data as { error: string }).error
					: `Load failed (${res.status})`
			throw new Error(msg)
		}
		editorContent = String((data as { content?: unknown }).content ?? '')
	} catch (e) {
		editorContent = ''
		saveError = e instanceof Error ? e.message : String(e)
	} finally {
		loadingNote = false
	}
}

const previewWikilinkHost: Action<HTMLElement> = (node) => {
	const onClick = (ev: MouseEvent) => {
		const el = (ev.target as HTMLElement | null)?.closest?.('[data-wikilink]')
		if (!(el instanceof HTMLElement)) return
		const raw = el.getAttribute('data-wikilink')
		if (!raw?.trim()) return
		ev.preventDefault()
		void openNote(normalizeWikilinkPath(raw))
	}
	node.addEventListener('click', onClick)
	return {
		destroy() {
			node.removeEventListener('click', onClick)
		}
	}
}

async function saveNote() {
	if (!selectedPath?.trim() || selectedPath === VAULT_INDEX_PATH) return
	const maiaKind = parseMaiaDocKind(selectedPath)
	saveError = null
	saving = true
	try {
		if (maiaKind) {
			const res = await fetch(`${origin}/api/memory/maia-doc?kind=${maiaKind}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editorContent })
			})
			const data: unknown = await res.json().catch(() => null)
			if (
				!res.ok ||
				data === null ||
				typeof data !== 'object' ||
				!('ok' in data) ||
				!(data as { ok?: boolean }).ok
			) {
				const msg =
					data !== null &&
					typeof data === 'object' &&
					'error' in data &&
					typeof (data as { error: unknown }).error === 'string'
						? (data as { error: string }).error
						: `Save failed (${res.status})`
				throw new Error(msg)
			}
		} else {
			const res = await fetch(`${origin}/api/memory/note`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: selectedPath, content: editorContent })
			})
			const data: unknown = await res.json().catch(() => null)
			if (
				!res.ok ||
				data === null ||
				typeof data !== 'object' ||
				!('ok' in data) ||
				!(data as { ok?: boolean }).ok
			) {
				const msg =
					data !== null &&
					typeof data === 'object' &&
					'error' in data &&
					typeof (data as { error: unknown }).error === 'string'
						? (data as { error: string }).error
						: `Save failed (${res.status})`
				throw new Error(msg)
			}
		}
		await refreshList()
	} catch (e) {
		saveError = e instanceof Error ? e.message : String(e)
	} finally {
		saving = false
	}
}

async function createBlank() {
	const name = window.prompt('New note path (e.g. Topics/Scratch.md)')
	if (!name?.trim()) return
	const path = name.trim().replace(/^\/+/, '')
	selectedPath = path
	editorContent = `# ${path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note'}\n\n`
	saveError = null
	viewMode = 'markdown'
}

onMount(() => {
	void refreshList()
})
</script>

<svelte:head> <title>Memory — Aven</title> </svelte:head>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
	{#if loadError}
		<div
			class={`${workspaceContentClass} mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error`}
			role="alert"
		>
			{loadError}
		</div>
	{/if}
	{#if saveError}
		<div
			class={`${workspaceContentClass} mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error`}
			role="alert"
		>
			{saveError}
		</div>
	{/if}

	<div
		class={`${workspaceContentClass} grid min-h-0 flex-1 grid-cols-1 gap-8 overflow-y-auto lg:min-h-0 lg:overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)] lg:items-stretch`}
	>
		<aside
			class="tech-card flex min-h-0 min-w-0 flex-col overflow-hidden p-4 lg:h-full lg:min-h-0 lg:max-h-full"
		>
			<div class="mb-3 flex shrink-0 items-center justify-between gap-2">
				<span class="tech-label shrink-0">Notes</span>
				<button
					type="button"
					class="shrink-0 text-[10px] font-bold uppercase tracking-wider opacity-60 hover:opacity-100"
					onclick={() => void refreshList()}
				>
					Refresh
				</button>
			</div>
			<button
				type="button"
				class="tech-pill mb-3 w-full justify-center py-2 text-xs font-semibold"
				onclick={() => createBlank()}
			>
				New note
			</button>
			<input
				bind:value={filter}
				placeholder="Filter…"
				class="mb-3 w-full rounded-xl border border-border bg-white/30 px-3 py-2 text-sm outline-none"
			>
			<ul
				class="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-y-contain max-h-[55vh] lg:max-h-none"
			>
				<li>
					<button
						type="button"
						class="w-full rounded-lg border border-dashed border-border/50 px-2 py-1.5 text-left text-sm transition-colors {isVaultIndexSelected
							? 'border-border/80 bg-foreground/10 font-semibold'
							: 'hover:border-border/80 hover:bg-white/15'}"
						onclick={() => openVaultIndex()}
						aria-current={isVaultIndexSelected ? 'page' : undefined}
					>
						<span class="block font-mono text-[10px] opacity-50">_index.md</span>
						<span class="block truncate">Vault index · live snapshot</span>
						{#if vaultSnapshotIso}
							<span class="mt-0.5 block text-[9px] font-mono opacity-35"
								>{vaultSnapshotMeta ?? ''}</span
							>
						{/if}
					</button>
				</li>
				<li class="mt-2 border-t border-border/35 pt-2">
					<span
						class="mb-2 block px-2 text-[9px] font-bold uppercase tracking-wider text-foreground/35"
						>agents / maia</span
					>
				</li>
				{#each MAIA_DOC_ROWS as row (row.kind)}
					<li>
						<button
							type="button"
							class="w-full rounded-lg border border-transparent px-2 py-1.5 text-left text-sm transition-colors {selectedPath ===
							maiaSentinelPath(row.kind)
								? 'border-border/70 bg-foreground/10 font-semibold'
								: 'hover:border-border/45 hover:bg-white/15'}"
							onclick={() => void openMaiaDoc(row.kind)}
							aria-current={selectedPath === maiaSentinelPath(row.kind) ? 'page' : undefined}
						>
							<span class="block font-mono text-[10px] opacity-50">{row.file}</span>
							<span class="block truncate">{row.hint}</span>
							<span class="mt-0.5 block text-[9px] font-mono opacity-30"
								>{diskPathForMaiaKind(row.kind)}</span
							>
						</button>
					</li>
				{/each}
				{#if loadingList}
					<li class="text-xs opacity-40">Loading…</li>
				{:else if filtered.length === 0}
					<li class="text-xs opacity-40">No notes {filter.trim() ? 'match filter' : 'yet'}.</li>
				{:else}
					{#each filtered as n (n.path)}
						<li>
							<button
								type="button"
								class="w-full text-left rounded-lg px-2 py-1.5 text-sm transition-colors {selectedPath === n.path
									? 'bg-foreground/10 font-semibold'
									: 'hover:bg-white/20'}"
								onclick={() => void openNote(n.path)}
							>
								<span class="block font-mono text-[10px] opacity-40 truncate">{n.path}</span>
								<span class="block truncate">{n.title}</span>
							</button>
						</li>
					{/each}
				{/if}
			</ul>
		</aside>

		<section
			class="tech-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 lg:h-full"
		>
			<div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
				{#if isVaultIndexSelected}
					<div class="min-w-0">
						<span
							class="block font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55"
							>_index.md</span
						>
						<span class="tech-label mt-0.5 block normal-case tracking-normal opacity-60"
							>Live snapshot (same as Talk context) · not a file on disk</span
						>
					</div>
				{:else if selectedMaiaKind}
					<div class="min-w-0">
						<span
							class="block truncate font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55"
							title={diskPathForMaiaKind(selectedMaiaKind)}
							>{diskPathForMaiaKind(selectedMaiaKind)}</span
						>
						<span class="tech-label mt-0.5 block normal-case tracking-normal opacity-60"
							>Maia runtime · loaded into Talk before the vault table</span
						>
					</div>
				{:else if selectedPath}
					<span
						class="min-w-0 truncate font-mono text-[10px] font-bold leading-none tracking-tight text-foreground/55"
						title={selectedPath}
						>{selectedPath}</span
					>
				{:else}
					<span class="tech-label">Select a note</span>
				{/if}
				<div class="flex shrink-0 flex-wrap items-center gap-2">
					<div
						class="inline-flex rounded-full border border-border/80 bg-white/15 p-0.5"
						role="group"
						aria-label="Note view"
					>
						<button
							type="button"
							disabled={!selectedPath || loadingNote}
							class="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-25 {viewMode ===
							'display'
								? 'bg-foreground/10 text-foreground'
								: 'opacity-50 hover:opacity-80'}"
							onclick={() => (viewMode = 'display')}
						>
							Display
						</button>
						<button
							type="button"
							disabled={!selectedPath || loadingNote}
							class="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-25 {viewMode ===
							'markdown'
								? 'bg-foreground/10 text-foreground'
								: 'opacity-50 hover:opacity-80'}"
							onclick={() => (viewMode = 'markdown')}
						>
							Markdown
						</button>
					</div>
					<button
						type="button"
						class="rounded-full border border-border px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-white/20 disabled:opacity-30"
						disabled={!selectedPath || saving || loadingNote || isVaultIndexSelected}
						onclick={() => void saveNote()}
					>
						{saving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
			{#if loadingNote}
				<p class="mb-2 shrink-0 text-xs opacity-40">Loading note…</p>
			{/if}
			<div class="flex min-h-0 flex-1 flex-col">
				{#if viewMode === 'display'}
					<div
						class="memory-prose min-h-0 w-full max-w-none flex-1 rounded-xl border border-border/90 bg-white/15 p-5 text-sm leading-relaxed overflow-x-hidden overflow-y-auto sm:p-6 [&_table]:text-[11px] sm:[&_table]:text-sm"
						role="region"
						aria-label="Rendered note preview"
						use:previewWikilinkHost
					>
						{#if isVaultIndexSelected}
							{#if !vaultSnapshotMarkdown.trim()}
								<p class="text-xs opacity-35">Empty vault — add Markdown under .data/knowledge.</p>
							{:else}
								{@html displayPanelHtml}
							{/if}
						{:else if !editorContent.trim()}
							<p class="text-xs opacity-35">Empty note — use Markdown to add content.</p>
						{:else}
							{@html displayPanelHtml}
						{/if}
					</div>
				{:else}
					<textarea
						bind:value={editorContent}
						readonly={isVaultIndexSelected}
						class="min-h-[12rem] w-full flex-1 resize-y rounded-xl border border-border/90 bg-white/15 p-4 font-mono text-sm leading-relaxed outline-none focus:ring-1 focus:ring-foreground/20 read-only:cursor-default read-only:bg-white/10"
						placeholder="Markdown source…"
						spellcheck="false"
					></textarea>
				{/if}
			</div>
		</section>
	</div>
</div>
