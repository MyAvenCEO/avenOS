<script lang="ts">
import { tick } from 'svelte'
import IntentActorColumn from '$lib/intent-mock/IntentActorColumn.svelte'
import IntentCenterPanel from '$lib/intent-mock/IntentCenterPanel.svelte'
import IntentLeftNav from '$lib/intent-mock/IntentLeftNav.svelte'
import IntentRightRail from '$lib/intent-mock/IntentRightRail.svelte'
import SelectedActorDetails from '$lib/intent-mock/SelectedActorDetails.svelte'
import {
	contextTabsForTier,
	firstTabForTier,
	isTabAllowedForTier
} from '$lib/intent-mock/actor-context-tabs'
import { AVENCEO_ACTOR_ID, MOCK_INVOLVED_ACTORS } from '$lib/intent-mock/boring-avatar'
import type { InvolvedActorId } from '$lib/intent-mock/involved-actors-display'
import type { ActorContextTab } from '$lib/intent-mock/types'
import { IntentStore } from '$lib/jaensen/intent-store.svelte'
import { workspaceOrchestratorClass } from '$lib/workspace/layout'

const COMPOSER_MAX_LINES = 4

let contextTab = $state<ActorContextTab>('overview')
let selectedActorId = $state<InvolvedActorId>(AVENCEO_ACTOR_ID)
let newTitle = $state('')
let busy = $state(false)
let dragActive = $state(false)
let pendingFile = $state<File | null>(null)
let fileInput: HTMLInputElement | null = null
let composerEl: HTMLTextAreaElement | null = null

const store = new IntentStore()

const intents = $derived.by(() => store.intentList())
const selectedIntent = $derived.by(() => store.selectedIntent())
const error = $derived(store.error)

const selectedActorTier = $derived.by(() => {
	return MOCK_INVOLVED_ACTORS.find((a) => a.id === selectedActorId)?.tier ?? 'worker'
})

const contextTabs = $derived.by(() => contextTabsForTier(selectedActorTier))

$effect(() => {
	void selectedIntent?.id
	selectedActorId = AVENCEO_ACTOR_ID
	contextTab = 'overview'
})

$effect(() => {
	if (!isTabAllowedForTier(contextTab, selectedActorTier)) {
		contextTab = firstTabForTier(selectedActorTier)
	}
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

$effect(() => {
	void store.init()
	return undefined
})

function selectIntent(id: string) {
	store.selectIntent(id)
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

function handleResolveHitl(
	todoId: string,
	payload:
		| { kind: 'text_reply'; text: string }
		| { kind: 'choice'; optionId: string }
		| { kind: 'approve_reject'; approved: boolean }
) {
	const intent = selectedIntent
	if (!intent) return
	busy = true
	store.error = null
	void (async () => {
		try {
			let message = ''
			if (payload.kind === 'text_reply') message = payload.text.trim()
			else if (payload.kind === 'choice') message = `Choice selected: ${payload.optionId}`
			else message = payload.approved ? 'Approved.' : 'Rejected.'
			if (!message) throw new Error('Response cannot be empty')
			await store.sendMessage(message, {
				intentIdHint: intent.id,
				resolvedQuestionId: todoId
			})
		} catch (err) {
			captureUiError('handleResolveHitl failed', err)
		} finally {
			busy = false
		}
	})()
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
				<IntentLeftNav
					{intents}
					selectedId={store.selectedIntentId}
					onSelect={selectIntent}
					onRemove={handleRemove}
				/>
			</div>
			<div class="flex h-full min-h-0 min-w-0 flex-col">
				<IntentCenterPanel
					intent={selectedIntent}
					panel={contextTab}
					selectedActorId={selectedActorId}
					onResolveHitl={handleResolveHitl}
				/>
			</div>
			{#if selectedIntent}
				<div class="flex min-h-0 w-fit min-w-0 shrink-0 flex-col self-stretch justify-start">
					<IntentRightRail
						tabs={contextTabs}
						tab={contextTab}
						onTab={(t) => (contextTab = t)}
					/>
				</div>
				<div class="min-h-0 max-w-31 shrink-0 xl:w-full">
					<div class="flex h-full min-h-0 flex-col gap-3">
						<div class="min-h-0 shrink-0">
							<IntentActorColumn
								intent={selectedIntent}
								selectedActorId={selectedActorId}
								onSelectActor={(id) => (selectedActorId = id)}
							/>
						</div>
						<div class="min-h-0 flex-1 border-l border-border/50 pl-2">
							<SelectedActorDetails intent={selectedIntent} {selectedActorId} />
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
