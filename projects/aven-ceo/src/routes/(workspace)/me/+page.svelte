<script lang="ts">
import {
	resolveHitlTodo as applyHitlResolution,
	openSyntheticHitlForDemo,
	removeIntent as removeIntentFromList,
	upsertIntent
} from '$lib/intent-mock/actions'
import IntentCenterPanel from '$lib/intent-mock/IntentCenterPanel.svelte'
import IntentLeftNav from '$lib/intent-mock/IntentLeftNav.svelte'
import IntentRightRail from '$lib/intent-mock/IntentRightRail.svelte'
import { buildSeedIntents, createIntentFromTitle } from '$lib/intent-mock/seed'
import type { IntentOrchestrator, RightPanelTab } from '$lib/intent-mock/types'
import { workspaceOrchestratorClass } from '$lib/workspace/layout'

const seed = buildSeedIntents()
let intents = $state<IntentOrchestrator[]>(seed)
let selectedId = $state<string | null>(seed[0]?.id ?? null)
let rightTab = $state<RightPanelTab>('overview')
let newTitle = $state('')

const selectedIntent = $derived(intents.find((i) => i.id === selectedId) ?? null)

function selectIntent(id: string) {
	selectedId = id
}

function handleRemove(id: string) {
	intents = removeIntentFromList(intents, id)
	if (selectedId === id) {
		selectedId = intents[0]?.id ?? null
	}
}

function addIntent() {
	const title = newTitle.trim()
	if (!title) return
	const next = createIntentFromTitle(title)
	intents = upsertIntent(intents, next)
	selectedId = next.id
	newTitle = ''
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
	intents = upsertIntent(intents, applyHitlResolution(intent, todoId, payload))
}

function handleDemoHitl() {
	const intent = selectedIntent
	if (!intent) return
	intents = upsertIntent(intents, openSyntheticHitlForDemo(intent))
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
	<main class={`${workspaceOrchestratorClass} flex-1 flex flex-col min-h-0 px-4 sm:px-6`}>
		<div
			class="grid grid-cols-1 min-h-0 flex-1 gap-8 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_auto] xl:gap-6 xl:items-stretch py-6"
		>
			<div class="min-w-0 min-h-0 flex flex-col xl:max-w-[22rem]">
				<IntentLeftNav {intents} {selectedId} onSelect={selectIntent} onRemove={handleRemove} />
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
						onsubmit={(e) => {
							e.preventDefault()
							addIntent()
						}}
					>
						<input
							bind:value={newTitle}
							placeholder="Add new intent (mock)…"
							class="w-full min-w-0 bg-transparent border-none p-0 text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0"
						>
					</form>
				</div>
				<div class="flex items-center gap-3 pl-3 border-l border-border shrink-0">
					<div class="flex flex-col items-end">
						<span class="text-[8px] font-bold uppercase opacity-30">Demo</span>
						<span class="text-xs font-bold uppercase tracking-tighter">Client-only</span>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>
