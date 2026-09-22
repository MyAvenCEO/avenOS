<script lang="ts">
import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Snippet } from 'svelte'
import { onMount } from 'svelte'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import {
	hitlQueue,
	resumeHeldAfterEnvironmentSwitch,
	suspendHeldForEnvironmentSwitch
} from '$lib/actors/hitl.svelte'
import { SPARKS, todoActor } from '$lib/actors/todo.svelte'
import { clientReconciliation } from '$lib/artifacts/client-reconciliation'
import { customerWork } from '$lib/artifacts/customer-work.svelte'
import { emailDocumentProcessing } from '$lib/artifacts/document-import-queue.svelte'
import { emailJob } from '$lib/artifacts/email-job.svelte'
import { resetCustomerWorkspace } from '$lib/artifacts/ingest.svelte'
import { restoreInputDrafts } from '$lib/chat/input-drafts'
import { shell } from '$lib/intents/talk.svelte'
import {
	currentSurface,
	openSurface,
	type Surface,
	toggleSurface
} from '$lib/shell/navigation.svelte'
import { studio, synchronizeStudio } from '$lib/skills/studio.svelte'

/**
 * The dashboard shell: the native rail selects an owned customer environment;
 * browser previews retain the Spark contexts. The rail stays put across the
 * workspace and settings page. Switching environments remounts customer views
 * and clears their in-memory projections while the native identity remains signed in.
 *
 * Which surface is open is decided in ONE place (`$lib/shell/navigation`), not
 * re-derived per button. The rail is one exclusive group: whatever it opens,
 * it closes the rest, so leaving settings is part of pressing any other
 * button and the gear itself toggles. That makes a Back link redundant.
 */
const { children }: { children: Snippet } = $props()

interface EnvironmentChoice {
	id: string
	purchasedName: string
	role: string
	desiredState: string
	observedState: string
	components: { observedState: string }[]
}
interface EnvironmentSelection {
	environments: EnvironmentChoice[]
	selectedEnvironmentId: string | null
}
let environmentSelection = $state<EnvironmentSelection | null>(null)
let environmentFailure = $state<string | null>(null)
let environmentBusy = $state(false)
let switching = $state(false)
let environmentPicker: HTMLDetailsElement | undefined = $state()
let environmentSearch = $state('')
const selectedEnvironment = $derived(
	environmentSelection?.environments.find(
		(entry) => entry.id === environmentSelection?.selectedEnvironmentId
	)
)
const blockedConnections = $derived(
	studio.snapshot?.connections.filter(
		(connection) => connection.last_error || connection.blocked_run
	) ?? []
)
const customerReady = $derived(
	(!isTauri() ||
		environmentSelection?.environments.some(
			(entry) => entry.id === environmentSelection?.selectedEnvironmentId
		)) &&
		!switching
)

function environmentAvailable(entry: EnvironmentChoice): boolean {
	return (
		entry.role === 'owner' &&
		entry.desiredState === 'ready' &&
		entry.observedState === 'ready' &&
		entry.components.every((component) => component.observedState === 'ready')
	)
}

const customerWriteBusy = $derived(
	chatActor.core.working ||
		chatActor.core.input.items.some((i) => i.stage === 'assigning') ||
		customerWork.uploads ||
		customerWork.documents > 0 ||
		customerWork.reconciliations > 0 ||
		customerWork.feedback > 0 ||
		customerWork.tasks > 0 ||
		customerWork.conversations > 0 ||
		emailDocumentProcessing.active > 0 ||
		emailDocumentProcessing.pending > 0 ||
		hitlQueue.saving > 0
)

function beginEnvironmentTransition(): boolean {
	if (customerWriteBusy || !suspendHeldForEnvironmentSwitch()) {
		environmentFailure = 'Warte, bis die aktuelle Kundenaktion abgeschlossen ist.'
		return false
	}
	if (!clientReconciliation.suspendForEnvironmentSwitch()) {
		resumeHeldAfterEnvironmentSwitch()
		environmentFailure = 'Warte, bis die aktuelle Kundenaktion abgeschlossen ist.'
		return false
	}
	return true
}

function finishEnvironmentTransition(): void {
	chatActor.core.input.resume()
	clientReconciliation.resumeAfterEnvironmentSwitch()
	resumeHeldAfterEnvironmentSwitch()
}

async function refreshEnvironments() {
	if (!isTauri()) return
	if (!beginEnvironmentTransition()) return
	environmentBusy = true
	environmentFailure = null
	try {
		await chatActor.core.input.suspend()
		const previous = environmentSelection?.selectedEnvironmentId
		const next = await invoke<EnvironmentSelection>('auth_environments')
		if (previous !== next.selectedEnvironmentId) {
			emailJob.resetForEnvironment()
			resetCustomerWorkspace()
		}
		environmentSelection = next
	} catch (cause) {
		environmentFailure = String(cause)
	} finally {
		finishEnvironmentTransition()
		environmentBusy = false
	}
}

async function selectEnvironment(id: string) {
	if (id === environmentSelection?.selectedEnvironmentId) return
	if (!beginEnvironmentTransition()) return
	environmentBusy = true
	switching = true
	environmentFailure = null
	try {
		await chatActor.core.input.suspend()
		const next = await invoke<EnvironmentSelection>('auth_environment_select', {
			environmentId: id
		})
		emailJob.resetForEnvironment()
		resetCustomerWorkspace()
		environmentSelection = next
	} catch (cause) {
		environmentFailure = String(cause)
	} finally {
		finishEnvironmentTransition()
		environmentBusy = false
		switching = false
	}
}

onMount(() => {
	void refreshEnvironments()
})

$effect(() => {
	const environmentId = environmentSelection?.selectedEnvironmentId
	if (!isTauri() || !customerReady || !environmentId) return
	let disposed = false
	void restoreInputDrafts(chatActor.core.input, () => !disposed).catch(() => {
		if (!disposed)
			environmentFailure =
				'Pending input could not be restored. Saved drafts have not been deleted.'
	})
	return () => {
		disposed = true
	}
})

$effect(() => {
	void environmentSelection?.selectedEnvironmentId
	void customerReady
	todoActor.reset()
})

// Delivery belongs to the authenticated workspace, not the Studio screen.
// The transport authorizes each pass; an environment switch tears down this loop.
$effect(() => {
	const environmentId = environmentSelection?.selectedEnvironmentId
	if (!isTauri() || !customerReady || !environmentId) return
	const tick = () => {
		void synchronizeStudio().catch(() => {})
	}
	tick()
	const timer = setInterval(tick, 7000)
	return () => clearInterval(timer)
})

const surface = $derived(currentSurface())

/**
 * The rail's foot, as data. These three used to be three near-identical blocks
 * of markup, each with its own copy of the active-class expression and its own
 * subtly different click handler — which is how they came to disagree.
 */
type IconShape =
	| { circle: [number, number, number]; d?: undefined }
	| { d: string; circle?: undefined }
type Tool = { id: Exclude<Surface, 'intents'>; label: string; paths: IconShape[] }

const TOOLS: Tool[] = [
	{
		id: 'skills',
		label: 'Skills',
		/* three linked nodes: the flow canvas, in miniature */
		paths: [
			{ circle: [5, 12, 2.5] },
			{ circle: [19, 6, 2.5] },
			{ circle: [19, 18, 2.5] },
			{ d: 'M7.2 10.8 16.8 7.2M7.2 13.2l9.6 3.6' }
		]
	},
	{
		id: 'artifacts',
		label: 'Artefakte',
		/* a document sheet with a folded corner: the artifact, in miniature */
		paths: [
			{ d: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z' },
			{ d: 'M14 3v4.5h4.5M9 12.5h6M9 16h6' }
		]
	},
	{
		id: 'settings',
		label: 'Einstellungen',
		/* gear */
		paths: [
			{ circle: [12, 12, 3] },
			{
				d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z'
			}
		]
	}
]

/** One shape for every rail button, so they cannot drift apart again. */
const BUTTON_BASE = 'flex size-11 items-center justify-center transition-all'
const BUTTON_ON = 'rounded-2xl bg-primary text-primary-foreground'
const BUTTON_OFF =
	'rounded-full border border-border bg-surface-card opacity-60 hover:rounded-2xl hover:opacity-100'

function buttonClass(active: boolean): string {
	return `${BUTTON_BASE} ${active ? BUTTON_ON : BUTTON_OFF}`
}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (environmentPicker?.open && event.target instanceof Node && !environmentPicker.contains(event.target)) environmentPicker.open = false
	}}
	onkeydown={(event) => { if (event.key === 'Escape' && environmentPicker) environmentPicker.open = false }}
/>

<div class="flex h-dvh">
	<!-- On phones the rail is part of the LIST screen: once an intent is open
	     the detail takes the full width and the rail steps out with the list. -->
	<aside
		class="{surface === 'intents' && shell.detail
			? 'hidden lg:flex'
			: 'flex'} w-16 shrink-0 flex-col items-center gap-3 border-border border-r py-4 pt-[max(1rem,env(safe-area-inset-top))]"
	>
		{#if isTauri()}
			<details bind:this={environmentPicker} class="environment-picker">
				<summary
					aria-label="Choose workspace"
					title={selectedEnvironment?.purchasedName ?? 'Choose workspace'}
					class="relative text-xs {buttonClass(true)}"
				>
					{selectedEnvironment?.purchasedName.slice(0, 2).toUpperCase() ?? '…'}
				</summary>
				<div class="environment-menu">
					<strong>Workspaces</strong>
					<input
						type="search"
						aria-label="Find a workspace"
						placeholder="Find a workspace…"
						bind:value={environmentSearch}
					>
					<div class="environment-list">
						{#each (environmentSelection?.environments ?? []).filter(entry => entry.purchasedName.toLowerCase().includes(environmentSearch.toLowerCase())) as entry (entry.id)}
							{@const active = entry.id === environmentSelection?.selectedEnvironmentId}
							<button
								type="button"
								data-testid="environment-choice-{entry.id}"
								onclick={() => { if (environmentPicker) environmentPicker.open = false; void selectEnvironment(entry.id) }}
								disabled={!environmentAvailable(entry) || environmentBusy || customerWriteBusy}
								title={customerWriteBusy ? 'Die aktuelle Kundenaktion wird abgeschlossen …' : `${entry.purchasedName}.aven.ceo`}
								aria-label="Umgebung {entry.purchasedName}.aven.ceo"
								aria-current={active ? 'page' : undefined}
								class="environment-option"
								class:active
							>
								<span
									>{entry.purchasedName}
									<small
										>{environmentAvailable(entry) ? (active ? 'Current workspace' : 'Ready') : entry.observedState}</small
									></span
								>
								{#if active}
									<span aria-hidden="true">✓</span>
								{/if}
							</button>
						{:else}
							<p>No matching workspace.</p>
						{/each}
					</div>
				</div>
			</details>
		{:else}
			{#each SPARKS as spark (spark.id)}
				{@const active = todoActor.state.active === spark.id && surface === 'intents'}
				<button
					type="button"
					onclick={() => {
					// One call puts the rail on the intents surface — route and flag
					// together — and the active spark is reducer state like any
					// other, switched through the SHOW event, the same door the
					// voice tool uses.
					openSurface('intents')
					void todoActor.show(spark.id === 'team' ? 'team' : 'me')
				}}
					title={spark.name}
					aria-label="Spark {spark.name}"
					class="relative text-xs {buttonClass(active)} {active ? '' : 'opacity-70'}"
				>
					{spark.id.slice(0, 2).toUpperCase()}
					{#if active}
						<span class="-left-[13px] absolute h-6 w-1 rounded-full bg-primary"></span>
					{/if}
				</button>
			{/each}
		{/if}

		<!-- The rail's foot: the tool surfaces, below the contexts. The way
		     "back" went with the game — the dashboard is the root now; there is
		     nothing behind it. -->
		{#each TOOLS as tool, i (tool.id)}
			{@const active = surface === tool.id}
			<button
				type="button"
				onclick={() => toggleSurface(tool.id)}
				title={tool.label}
				aria-label={tool.label}
				class="relative {buttonClass(active)} {i === 0 ? 'mt-auto' : ''}"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					{#each tool.paths as shape, j (j)}
						{#if shape.circle}
							<circle cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} />
						{:else}
							<path d={shape.d} />
						{/if}
					{/each}
				</svg>
				{#if active}
					<span class="-left-[13px] absolute h-6 w-1 rounded-full bg-primary"></span>
				{/if}
			</button>
		{/each}
	</aside>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		{#if environmentFailure}
			<p class="px-4 py-2 text-sm text-error-ink">{environmentFailure}</p>
		{/if}
		{#if customerReady}
			{#if studio.synchronizationError}
				<div
					role="status"
					class="flex items-center justify-between gap-3 px-4 py-2 text-sm text-error-ink"
				>
					<span>Automatic Skills could not check for new items.</span>
					<button type="button" onclick={() => { void synchronizeStudio().catch(() => {}) }}>
						Retry
					</button>
					<details>
						<summary>Details</summary>
						{studio.synchronizationError}
					</details>
				</div>
			{:else if blockedConnections.length}
				<div
					role="status"
					class="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm text-error-ink"
				>
					<span
						>{blockedConnections.length === 1 ? 'An automatic Skill needs attention.' : `${blockedConnections.length} automatic Skills need attention.`}</span
					>
					<button
						type="button"
						onclick={() => { studio.requestedTab = 'activity'; openSurface('skills') }}
					>
						Review activity →
					</button>
				</div>
			{/if}
			{#key environmentSelection?.selectedEnvironmentId ?? 'browser'}
				{@render children()}
			{/key}
		{:else}
			<main class="grid min-h-0 flex-1 place-items-center p-6 text-center">
				<p>
					{environmentBusy ? 'Umgebungen werden geladen …' : 'Wähle links eine deiner Umgebungen, um deine Arbeit zu öffnen.'}
				</p>
			</main>
		{/if}
	</div>
</div>

<style>
.environment-picker {
	position: relative;
	flex-shrink: 0;
	z-index: 100;
}
.environment-picker summary {
	list-style: none;
	cursor: pointer;
}
.environment-picker summary::-webkit-details-marker {
	display: none;
}
.environment-menu {
	position: absolute;
	top: 0;
	left: calc(100% + 1rem);
	width: min(22rem, calc(100vw - 5rem));
	padding: 1rem;
	border: 1px solid var(--color-border, #ddd);
	border-radius: 1rem;
	background: var(--color-surface-card, #fffdf7);
	box-shadow: 0 12px 40px #18232d20;
}
.environment-menu input {
	display: block;
	width: 100%;
	margin: 0.75rem 0;
	padding: 0.6rem 0.75rem;
	border: 1px solid var(--color-border, #ddd);
	border-radius: 0.6rem;
}
.environment-list {
	max-height: min(65dvh, 30rem);
	overflow-y: auto;
}
.environment-option {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	width: 100%;
	padding: 0.75rem;
	border-radius: 0.6rem;
	text-align: left;
	overflow-wrap: anywhere;
}
.environment-option small {
	display: block;
	opacity: 0.65;
	font-size: 0.75rem;
}
.environment-option:hover,
.environment-option.active {
	background: #438e8514;
}
.environment-option:disabled {
	opacity: 0.45;
}
</style>
