<script lang="ts">
import IntentCenterPanel from '$lib/intent-mock/IntentCenterPanel.svelte'
import IntentLeftNav from '$lib/intent-mock/IntentLeftNav.svelte'
import IntentRightRail from '$lib/intent-mock/IntentRightRail.svelte'
import { IntentStore } from '$lib/jaensen/intent-store.svelte'
import type { RightPanelTab } from '$lib/intent-mock/types'
import { workspaceOrchestratorClass } from '$lib/workspace/layout'

let rightTab = $state<RightPanelTab>('overview')
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

function captureUiError(context: string, err: unknown) {
	console.error(`[aven-ceo][/me] ${context}`, err)
	store.error = err instanceof Error ? err.stack ?? err.message : String(err)
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
		await store.sendMessage(text || `Please ingest attachment ${pendingFile?.name ?? ''}`, { attachment })
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

async function fileToAttachment(file: File): Promise<{ name?: string; contentType?: string; base64: string }> {
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
			await store.sendMessage(message, { intentIdHint: intent.id })
		} catch (err) {
			captureUiError('handleResolveHitl failed', err)
		} finally {
			busy = false
		}
	})()
}

function handleDemoHitl() {
	console.info('TODO open Jaensen HITL')
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

<div class="flex flex-1 flex-col min-h-0 overflow-y-auto">
	{#if error}
		<div class="px-6 pt-4 text-sm text-error">{error}</div>
	{/if}
	<main class={`${workspaceOrchestratorClass} flex-1 flex flex-col min-h-0 px-4 sm:px-6`}>
		<div
			class="grid grid-cols-1 min-h-0 flex-1 gap-8 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_auto] xl:gap-6 xl:items-stretch py-6"
		>
			<div class="min-w-0 min-h-0 flex flex-col xl:max-w-[22rem]">
				<IntentLeftNav intents={intents} selectedId={store.selectedIntentId} onSelect={selectIntent} onRemove={handleRemove} />
			</div>
			<div class="min-w-0 min-h-0 flex flex-col">
				<IntentCenterPanel
					intent={selectedIntent}
					panel={rightTab}
					onResolveHitl={handleResolveHitl}
					onDemoHitl={handleDemoHitl}
				/>
			</div>
			<div class="min-h-0 shrink-0 flex flex-col">
				<IntentRightRail tab={rightTab} onTab={(t) => (rightTab = t)} />
			</div>
		</div>
	</main>

	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 pt-10 bg-gradient-to-t from-background from-40% via-background/95 to-transparent"
	>
		<div class={`pointer-events-auto w-full ${workspaceOrchestratorClass} px-4 sm:px-6`}>
			<section class="tech-pill py-3 px-4 sm:px-5 justify-between gap-4 w-full">
				<div class="flex items-center gap-3 flex-1 min-w-0">
					<div
						class="size-9 shrink-0 rounded-full border border-border flex items-center justify-center bg-white/20"
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
						<input bind:this={fileInput} type="file" class="hidden" onchange={onFileChange} />
						<div class={`w-full min-w-0 ${dragActive ? 'opacity-70' : ''}`}>
							<textarea
								bind:this={composerEl}
								bind:value={newTitle}
								placeholder={pendingFile ? `Ready: ${pendingFile.name}` : 'Send to Jaensen dispatcher…'}
								disabled={busy}
								rows="2"
								onkeydown={(event) => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault()
										void addIntent()
									}
								}}
								class="w-full min-w-0 resize-none bg-transparent border-none p-0 text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0"
							></textarea>
						{#if pendingFile}
							<div class="mt-2 flex items-center gap-2 text-xs opacity-70">
								<span>Attachment:</span>
								<strong>{pendingFile.name}</strong>
								<button type="button" class="underline" onclick={() => { pendingFile = null; if (fileInput) fileInput.value = '' }}>clear</button>
							</div>
						{:else}
							<div class="mt-2 flex items-center gap-2 text-xs opacity-50">
								<button type="button" class="underline" onclick={() => fileInput?.click()}>upload file</button>
								<span>or drag and drop here</span>
							</div>
						{/if}
						</div>
					</form>
				</div>
				<div class="flex items-center gap-3 pl-3 border-l border-border shrink-0">
					<div class="flex flex-col items-end">
						<span class="text-[8px] font-bold uppercase opacity-30">Live</span>
						<span class="text-xs font-bold uppercase tracking-tighter">Jaensen</span>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>
