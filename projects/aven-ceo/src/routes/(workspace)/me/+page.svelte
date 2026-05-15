<script lang="ts">
import { tick } from 'svelte'
import ActorDetailsPanel from '$lib/jaensen/ActorDetailsPanel.svelte'
import DetailTabsRail from '$lib/jaensen/DetailTabsRail.svelte'
import ActorTreeColumn from '$lib/jaensen/ActorTreeColumn.svelte'
import IntentListColumn from '$lib/jaensen/IntentListColumn.svelte'
import { MeStore, intentActorId, selectionKey } from '$lib/jaensen/me-store.svelte'
import type { ActorDetailTab } from '$lib/jaensen/types'
import { workspaceOrchestratorClass } from '$lib/workspace/layout'

const COMPOSER_MAX_LINES = 4

const TABS: Array<{ id: ActorDetailTab; label: string }> = [
	{ id: 'log', label: 'Log' },
	{ id: 'messages', label: 'Messages' },
	{ id: 'context', label: 'Context' },
	{ id: 'state', label: 'State' },
	{ id: 'config', label: 'Config' },
	{ id: 'debug', label: 'Debug' }
]

let newTitle = $state('')
let busy = $state(false)
let dragActive = $state(false)
let pendingFile = $state<File | null>(null)
let fileInput: HTMLInputElement | null = null
let composerEl: HTMLTextAreaElement | null = null

const store = new MeStore()

const intents = $derived(store.intents)
const selectedIntent = $derived(store.selectedIntent)
const error = $derived(store.error)

$effect(() => {
	void store.init()
	return undefined
})

function resizeComposer() {
	const el = composerEl
	if (!el) return
	el.style.height = 'auto'
	const style = getComputedStyle(el)
	const lineHeight = parseFloat(style.lineHeight)
	const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
	const lh =
		Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : (parseFloat(style.fontSize) || 16) * 1.3
	const maxPx = lh * COMPOSER_MAX_LINES + (Number.isFinite(pad) ? pad : 0)
	const h = Math.min(el.scrollHeight, maxPx)
	el.style.height = `${h}px`
	el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
}

$effect(() => {
	void newTitle
	void busy
	void composerEl
	void tick().then(() => resizeComposer())
})

function captureUiError(context: string, err: unknown) {
	console.error(`[aven-ceo][/me] ${context}`, err)
	store.error = err instanceof Error ? (err.stack ?? err.message) : String(err)
}

function selectIntent(id: string) {
	void store.selectIntent(id)
}

function handleRemove(id: string) {
	store.removeIntent(id)
}

async function addIntent() {
	const text = newTitle.trim()
	if ((!text && !pendingFile) || busy) return
	busy = true
	store.error = null
	try {
		const attachment = pendingFile ? await fileToAttachment(pendingFile) : undefined
		await store.sendMessage(text || `Please ingest attachment ${pendingFile?.name ?? ''}`, {
			attachment
		})
		newTitle = ''
		pendingFile = null
		if (fileInput) fileInput.value = ''
	} catch (err) {
		captureUiError('addIntent failed', err)
	} finally {
		busy = false
	}
}

function onDragOver(event: DragEvent) {
	event.preventDefault()
	dragActive = true
}

function onDragLeave(event: DragEvent) {
	event.preventDefault()
	dragActive = false
}

function onDrop(event: DragEvent) {
	event.preventDefault()
	dragActive = false
	const file = event.dataTransfer?.files?.[0]
	if (file) pendingFile = file
}

function onFileChange(event: Event) {
	const target = event.currentTarget as HTMLInputElement
	const file = target.files?.[0]
	if (file) pendingFile = file
}

async function fileToAttachment(
	file: File
): Promise<{ name?: string; contentType?: string; base64: string }> {
	const buffer = await file.arrayBuffer()
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return {
		name: file.name,
		contentType: file.type || 'application/octet-stream',
		base64: btoa(binary)
	}
}

</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
		rel="stylesheet"
	>
	<title>My workspace — Aven Maia</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0 overflow-hidden">
	{#if error}
		<div class="px-6 pt-4 text-sm text-error">{error}</div>
	{/if}
	<main class={`${workspaceOrchestratorClass} flex-1 flex flex-col min-h-0 px-3 sm:px-5`}>
		<div
			class="grid grid-cols-1 min-h-0 flex-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto_minmax(0,7.75rem)] xl:gap-3 xl:items-stretch pt-1 pb-1"
		>
			<div class="min-w-0 min-h-0 flex flex-col xl:max-w-[15rem]">
				<IntentListColumn
					{intents}
					selectedId={store.selectedIntentId}
					onSelect={selectIntent}
					onRemove={handleRemove}
				/>
			</div>
			<div class="flex h-full min-h-0 min-w-0 flex-col">
				<section class="min-h-0 flex-1 overflow-auto rounded-xl border border-border/40 bg-background/45 p-4">
					{#if selectedIntent}
						<h2 class="text-lg font-semibold tracking-tight">{selectedIntent.title ?? 'Untitled intent'}</h2>
						<p class="mt-1 text-sm opacity-65">{selectedIntent.summary ?? 'No summary available.'}</p>
						<div class="mt-3 text-[11px] opacity-55">Intent: {selectedIntent.id} · Actor: {store.selectedActorId}</div>
						<div class="mt-4 min-h-0 flex-1">
							<ActorDetailsPanel
								tab={store.selectedTab}
								events={store.selectedIntentId && store.selectedActorId ? store.eventsBySelection[selectionKey(store.selectedIntentId, store.selectedActorId, store.selectedTab)] ?? [] : []}
								envelopes={store.selectedIntentId && store.selectedActorId ? store.envelopesBySelection[selectionKey(store.selectedIntentId, store.selectedActorId, store.selectedTab)] ?? [] : []}
								contextItems={store.selectedIntentId && store.selectedActorId ? store.contextBySelection[selectionKey(store.selectedIntentId, store.selectedActorId, store.selectedTab)] ?? [] : []}
								actorDetail={store.selectedActorId ? store.actorDetails[store.selectedActorId] ?? null : null}
							/>
						</div>
					{:else}
						<div class="opacity-45">No intent selected.</div>
					{/if}
				</section>
			</div>
			{#if selectedIntent}
				<div class="flex min-h-0 w-fit min-w-0 shrink-0 flex-col self-stretch justify-start">
					<DetailTabsRail
						tabs={TABS}
						tab={store.selectedTab}
						onTab={(t) => void store.selectTab(t)}
					/>
				</div>
				<div class="min-h-0 max-w-31 shrink-0 xl:w-full">
					<div class="flex h-full min-h-0 flex-col gap-3">
						<div class="min-h-0 flex-1">
							<ActorTreeColumn
								actors={store.selectedActors}
								selectedActorId={store.selectedActorId ?? intentActorId(selectedIntent.id)}
								onSelectActor={(id) => void store.selectActor(id)}
							/>
						</div>
					</div>
				</div>
			{:else}
				<div class="hidden min-h-0 w-0 shrink-0 flex-col xl:flex" aria-hidden="true"></div>
				<div class="hidden min-h-0 max-w-31 shrink-0 xl:block xl:w-full" aria-hidden="true"></div>
			{/if}
		</div>
	</main>

	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-background from-55% via-background/88 to-transparent px-3 pb-4 pt-3 sm:px-5 sm:pb-5"
	>
		<div class={`pointer-events-auto w-full ${workspaceOrchestratorClass} px-3 sm:px-5`}>
			<section
				class="tech-pill !rounded-2xl max-w-full w-full items-start justify-between gap-2.5 py-2.5 px-3 sm:gap-3 sm:px-4"
			>
				<div class="flex min-w-0 flex-1 items-start gap-2 sm:gap-2.5">
					<div
						class="size-8 shrink-0 self-start rounded-full border border-border flex items-center justify-center bg-white/20 mt-0.5 sm:size-9"
					>
						<svg
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
							/>
						</svg>
					</div>
					<form
						class="flex-1 min-w-0"
						ondragover={onDragOver}
						ondragleave={onDragLeave}
						ondrop={onDrop}
						onsubmit={(e) => {
							e.preventDefault()
							void addIntent()
						}}
					>
						<input bind:this={fileInput} type="file" class="hidden" onchange={onFileChange}>
						<div class={`w-full min-w-0 ${dragActive ? 'opacity-70' : ''}`}>
							<textarea
								bind:this={composerEl}
								bind:value={newTitle}
								placeholder={pendingFile ? `Ready: ${pendingFile.name}` : 'Send to Jaensen dispatcher…'}
								disabled={busy}
								rows="1"
								oninput={resizeComposer}
								onkeydown={(event) => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault()
										void addIntent()
									}
								}}
								class="w-full min-h-0 min-w-0 resize-none overflow-hidden bg-transparent border-none p-0 text-lg sm:text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0 leading-snug"
							></textarea>
							{#if pendingFile}
								<div class="mt-1 flex items-center gap-2 text-[11px] opacity-70">
									<span>Attachment:</span>
									<strong>{pendingFile.name}</strong>
									<button
										type="button"
										class="underline"
										onclick={() => { pendingFile = null; if (fileInput) fileInput.value = '' }}
									>
										clear
									</button>
								</div>
							{:else}
								<div class="mt-1 flex items-center gap-2 text-[11px] opacity-50">
									<button type="button" class="underline" onclick={() => fileInput?.click()}>
										upload file
									</button>
									<span>or drag and drop here</span>
								</div>
							{/if}
						</div>
					</form>
				</div>
				<div class="flex shrink-0 flex-col items-end border-l border-border pl-2 pt-1 sm:pl-2.5">
					<span class="text-[8px] font-bold uppercase opacity-30">Live</span>
					<span class="text-xs font-bold uppercase tracking-tighter">Jaensen</span>
				</div>
			</section>
		</div>
	</div>
</div>
