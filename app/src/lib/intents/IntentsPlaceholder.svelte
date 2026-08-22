<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import { untrack } from 'svelte'
import '@xyflow/svelte/dist/style.css'
import AvenUiView from '$lib/actors/AvenUiView.svelte'
import { ACTIVITY_LABELS, activity } from '$lib/actors/activity.svelte'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { hitlQueue } from '$lib/actors/hitl.svelte'
import { registryTick } from '$lib/actors/reactivity.svelte'
import { isWindow } from '$lib/actors/window.actor.svelte'
import { composer } from '$lib/intents/composer.svelte'
import {
	type IntentState,
	intents,
	type MockArtifact,
	type SkillStatus
} from '$lib/intents/intents.svelte'
import { shell } from '$lib/intents/talk.svelte'
import FitView from '$lib/mesh/FitView.svelte'
import GatePreview from '$lib/query/GatePreview.svelte'
import { query } from '$lib/query/query.svelte'
import FlowNode from '$lib/skills/FlowNode.svelte'
import { layoutWorkflow } from '$lib/skills/flow-layout'
import { nameOf, skillById } from '$lib/skills/registry'

/**
 * The Intents workspace — instances MOCKED (0158), but the skill flows are
 * the REAL templates from the skills registry: template and instance are
 * one source. Three panes in the mail-app reading:
 *
 *   left   — the intent stream (compact cards, cream selection)
 *   center — the ACTIVITY LOG (every entry TYPED by the skill that wrote
 *            it), OR an artifact preview (full width), OR the skill's
 *            ACTUAL workflow rendered as the n8n canvas with the
 *            instance state overlaid on its nodes
 *   right  — SKILLS (click → the instance-on-template flow) above
 *            ARTIFACTS (click → preview)
 *
 * A PENDING HITL never lives in the log alone: it surfaces in the global
 * HITL bar above the voice pill (the one confirm interface); the log
 * keeps the entry as history. Submitted/answered gates stay log lines.
 */

/**
 * Intent types wear ONE quiet badge, not five coloured ones. Five hues
 * competing down the stream drowned out the thing that actually changes —
 * the 4px state edge — so type is now carried by the WORD alone and colour
 * is spent only where it means something. A map of five identical values
 * would just be a place to start re-colouring, hence a single constant.
 */
const TYPE_BADGE = 'bg-quiet/15 text-quiet-ink'

/**
 * The five states an intent can be in — each with its own accent, worn as
 * a 4px edge on the card so the stream is readable at a glance.
 */

const STATUS_LABEL: Record<IntentState, string> = {
	working: 'läuft',
	waiting: 'wartet auf dich',
	done: 'erledigt',
	error: 'Fehler',
	archive: 'archiviert'
}

/**
 * THE state→role mapping. It used to be restated in app.css as a layer of
 * `--color-state-*` aliases; a state is just a meaning borrowing a role, so
 * one table is enough and this is it.
 *
 * edge = the 4px left border, text = the status word (the `-ink` face, which
 * is the tone darkened far enough to be read on cream).
 *
 * Archive is deliberately absent: archived intents are filtered out of this
 * list into their own collapsed section, where being folded away and dimmed
 * already says "archived". A colour for it would be a colour nobody reads.
 */
/**
 * `fill` is the SELECTED card: the whole card in the state's color, with
 * that color's own foreground — the one card on the list you cannot miss,
 * and it says its state without a legend.
 */
const STATE_ACCENT: Record<
	Exclude<IntentState, 'archive'>,
	{ edge: string; text: string; fill: string }
> = {
	working: {
		edge: 'border-l-progress',
		text: 'text-progress-ink',
		fill: 'bg-progress text-progress-foreground'
	},
	waiting: { edge: 'border-l-info', text: 'text-info-ink', fill: 'bg-info text-info-foreground' },
	done: {
		edge: 'border-l-success',
		text: 'text-success-ink',
		fill: 'bg-success text-success-foreground'
	},
	error: { edge: 'border-l-error', text: 'text-error-ink', fill: 'bg-error text-error-foreground' }
}

/** What archive wears instead: the page's own ink, held well back. */
const NO_ACCENT = {
	edge: 'border-l-foreground/20',
	text: 'text-foreground/45',
	fill: 'bg-foreground/70 text-background'
}

/**
 * An archived intent never reaches the active list, but it CAN be selected
 * out of the archive drawer — so the centre pane still has to answer for it.
 */
const accentFor = (status: IntentState) => (status === 'archive' ? NO_ACCENT : STATE_ACCENT[status])

const KIND_LABEL: Record<string, string> = {
	doc: 'PDF',
	todo: 'TODO',
	calendar: 'KAL',
	person: 'WER',
	entity: 'BRAIN',
	statement: 'KONTO'
}

const selected = $derived(
	intents.items.find((i) => i.id === intents.selectedId) ?? intents.items[0]
)

/**
 * Talk to MAIA — the REAL chat: the transcript comes from the chat actor,
 * the input from the global voice/text pill, and the answers may be
 * INLINE VIEWS — every window actor the model (or a click) opens renders
 * right here in the conversation. The Views tab is gone; this is where
 * views live now.
 */
const chat = chatActor.core

/** Done intents rest in the archive — a toggle, closed by default. */
let archiveOpen = $state(false)
/** What needs you first: broken, then blocked, then moving, then settled. */
const STATE_ORDER: Record<IntentState, number> = {
	error: 0,
	waiting: 1,
	working: 2,
	done: 3,
	archive: 4
}
const activeIntents = $derived(
	intents.items
		.filter((i) => i.status !== 'archive')
		.sort((a, b) => STATE_ORDER[a.status] - STATE_ORDER[b.status])
)
const archivedIntents = $derived(intents.items.filter((i) => i.status === 'archive'))

/**
 * The center shows ONE of three things: the activity log (default), an
 * artifact preview, or a skill's flow stepper. Selecting an intent — or
 * the back button — returns to the log.
 */
let preview = $state<MockArtifact | null>(null)
let skillView = $state<SkillStatus | null>(null)

/**
 * Every intent's gate goes into the REAL queue, tagged with its intent —
 * the bar above the pill shows only the one whose intent is on screen.
 */
// The queue is an HMR-surviving singleton: drop gates from earlier mock
// generations, or a stale one without its preview shadows the real thing.
const mockIds = new Set(intents.items.filter((i) => i.hitl).map((i) => `mock-${i.id}`))
hitlQueue.items = hitlQueue.items.filter((h) => !h.id.startsWith('mock-') || mockIds.has(h.id))

for (const intent of intents.items) {
	if (!intent.hitl) continue
	const id = `mock-${intent.id}`
	if (hitlQueue.items.some((h) => h.id === id)) continue
	hitlQueue.items.push({
		id,
		actor: intent.hitl.actor,
		method: intent.hitl.method,
		label: intent.hitl.label,
		detail: intent.hitl.preview.title,
		context: intent.id,
		preview: intent.hitl.preview
	})
}

/**
 * The selected skill instance rendered ON its template workflow — the
 * same layout + node cards as the Skills viewer, the instance state
 * (done/current) overlaid per node.
 */
let sfNodes = $state.raw<Node[]>([])
let sfEdges = $state.raw<Edge[]>([])
$effect.pre(() => {
	const view = skillView
	if (!view) {
		sfNodes = []
		sfEdges = []
		return
	}
	const template = skillById(view.skill)
	const wf = template?.workflows.find((w) => w.id === view.workflow) ?? template?.workflows[0]
	if (!wf) {
		sfNodes = []
		sfEdges = []
		return
	}
	const laid = layoutWorkflow(wf)
	sfNodes = laid.nodes.map((n) => ({
		id: n.id,
		type: 'flow',
		position: n.position,
		draggable: false,
		data: {
			node: n.node,
			selected: false,
			instance: view.done.includes(n.id)
				? ('done' as const)
				: n.id === view.current
					? view.state === 'waiting'
						? ('waiting' as const)
						: ('running' as const)
					: undefined
		}
	}))
	sfEdges = laid.edges.map((e, i) => ({
		id: `${e.from}-${e.predicate}-${e.to}-${i}`,
		source: e.from,
		target: e.to,
		label: e.predicate,
		type: 'smoothstep',
		style: 'stroke: rgba(47,93,80,0.5); stroke-width: 1.5;',
		labelStyle: 'font-size: 10px; fill: rgba(30,41,59,0.7);',
		labelBgStyle: 'fill: var(--color-linen);',
		labelBgPadding: [4, 2] as [number, number],
		labelBgBorderRadius: 4
	}))
})
const sfNodeTypes = { flow: FlowNode }
let sfW = $state(0)
let sfH = $state(0)

/**
 * The center column follows its content: like a chat, the newest thing —
 * a fresh log entry, a streamed reply, an opened inline view — is always
 * in sight at the bottom.
 */
// The conversation is ABOUT what is on screen: selecting an intent switches
// the chat to that intent's own session stream, and scopes the gates.
$effect(() => {
	query.intent = intents.selectedId
	chat.use(intents.selectedId)
})

/**
 * THE VIEWS: the window actors (0130) — Todos, Kanban Board — every one a
 * tab beside the activity stream, and a row under VIEWS on the right. Two
 * ways in: click the tab, or ask ("zeig mir das Board") — the model opens
 * the window and the center follows it.
 */
const allWindows = $derived(registryTick.v >= 0 ? bus.actors().filter(isWindow) : [])
/** The tab in front: a window id, or null for the activity stream. */
let viewId = $state<string | null>(null)
const view = $derived(allWindows.find((w) => w.manifest.id === viewId) ?? null)

/** Put a view in front — by tab, by the list on the right, or by voice. */
function showView(id: string | null) {
	viewId = id
	preview = null
	skillView = null
	// The window flags ARE the shown/hidden truth the model reads back, so
	// clicking keeps them honest: the one in front is open, the rest are not.
	for (const w of allWindows) w.open = w.manifest.id === id
}

// Voice: a window the model just opened comes to the front; the one in
// front closing (or being hidden by message) returns to the stream.
let openBefore = new Set<string>()
$effect(() => {
	const openNow = allWindows.filter((w) => w.open).map((w) => w.manifest.id)
	untrack(() => {
		const newly = openNow.find((id) => !openBefore.has(id))
		if (newly !== undefined && newly !== viewId) {
			viewId = newly
			preview = null
			skillView = null
		} else if (viewId !== null && !openNow.includes(viewId)) {
			viewId = null
		}
		openBefore = new Set(openNow)
	})
})

let composerEl: HTMLTextAreaElement | null = $state(null)
$effect(() => {
	void composer.focusTick
	composerEl?.focus()
})

/** Enter sends, shift+enter makes a newline — the usual bargain. */
function onComposerKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		composer.send()
	} else if (event.key === 'Escape') {
		// Escape is the discard: the draft goes, the card goes.
		composer.draft = ''
		composer.active = false
	}
}

/** The gates this intent is holding; one raised without a context is global. */
const gates = $derived(
	hitlQueue.items.filter((h) => h.context === undefined || h.context === intents.selectedId)
)

/**
 * The log, minus the entry that only announces a pending gate. With the gate
 * card right below, that line said the same thing twice — and the weaker of
 * the two, since it cannot be acted on. Once the gate is answered the entry
 * comes back, because then it IS history.
 */
const logEntries = $derived(gates.length > 0 ? selected.log.filter((e) => !e.hitl) : selected.log)

/**
 * The composer and the gate share one slot under the log. While you write,
 * the composer has it and the gate waits — it is still held; it comes back
 * the moment the field goes away.
 */
const composing = $derived(composer.composing || chat.routing !== null)

let centerEl: HTMLElement | null = $state(null)
/** Whether the reader is riding the bottom; scrolling up deliberately parks it. */
let stick = $state(true)

/**
 * The log ends at its end, so the newest entry sits right above the gate.
 *
 * Synchronous, deliberately. An earlier version scrolled inside
 * `requestAnimationFrame` and never ran at all in a tab that is not
 * compositing — a hidden or background tab has no animation frames, so the
 * log would still be at the top when you came back to it. `$effect` already
 * runs after the DOM is updated, so the frame bought nothing.
 *
 * The dependencies are PASSED IN rather than touched with `void`, so the read
 * the compiler tracks is the same one the reader sees.
 */
function scrollToBottom(_deps: unknown): void {
	centerEl?.scrollTo({ top: centerEl.scrollHeight })
}

// Switching intent is a fresh start: whatever was scrolled to belonged to the
// intent just left.
$effect(() => {
	stick = true
	scrollToBottom(intents.selectedId)
})

// New content, or the gate appearing and taking height away.
$effect(() => {
	const deps = [
		logEntries.length,
		gates.length,
		registryTick.v,
		chat.turns.length,
		chat.turns.at(-1)?.content,
		activity.current
	]
	if (stick) scrollToBottom(deps)
})

// The gate is a SIBLING that renders in the same tick and then changes how
// much room the log has, so the box can settle after any scroll we time.
$effect(() => {
	const el = centerEl
	if (!el) return
	const observer = new ResizeObserver(() => {
		if (stick) el.scrollTo({ top: el.scrollHeight })
	})
	observer.observe(el)
	return () => observer.disconnect()
})

const DOT: Record<string, string> = {
	done: 'bg-success text-success-foreground',
	running: 'bg-progress text-progress-foreground',
	waiting: 'bg-info text-info-foreground'
}
</script>

{#snippet tab(id: string | null, label: string)}
	<button
		type="button"
		onclick={() => showView(id)}
		aria-current={viewId === id ? 'page' : undefined}
		class="rounded-full px-3 py-1 font-medium text-xs transition-colors {viewId === id
			? 'bg-primary text-primary-foreground'
			: 'border border-foreground/10 text-foreground/60 hover:bg-surface-card'}"
	>
		{label}
	</button>
{/snippet}

{#snippet backButton()}
	<button
		type="button"
		onclick={() => {
			preview = null
			skillView = null
		}}
		class="ml-auto shrink-0 rounded-full border border-foreground/10 px-3 py-1 text-foreground/60 text-xs transition-colors hover:bg-surface-card"
	>
		← Zurück zum Verlauf
	</button>
{/snippet}

<!-- The 85% UI scale lives on `html` (app.css), not on a zoom wrapper here:
     rem sizes shrink, px borders stay honest, and the dock clearance needs no
     dividing back out because nothing is scaled relative to anything else. -->
<div class="flex min-h-0 w-full flex-1 gap-3 overflow-hidden">
	<!-- LEFT: the intent stream — compact cards, cream selection.
	     On phones this IS the home screen, full width; opening an intent
	     swaps it for the detail (`shell.detail`). -->
	<aside
		class="{shell.detail
			? 'hidden lg:flex'
			: 'flex'} min-h-0 w-full shrink-0 flex-col gap-2 overflow-y-auto pb-2 lg:w-72"
	>
		<!-- The side headers wear the tab strip's pill, so all three columns
		     start their cards on one edge and read as one row. -->
		<h2 class="flex justify-center px-1 pt-1">
			<span
				class="rounded-full border border-foreground/10 px-3 py-1 font-medium text-foreground/60 text-xs"
			>
				Intents · {activeIntents.length}
			</span>
		</h2>
		{#each activeIntents as intent (intent.id)}
			{@const sel = intents.selectedId === intent.id}
			{@const accent = accentFor(intent.status)}
			<!-- Hover shifts the FILL, never the border: `hover:border-*` paints all
			     four sides and, sitting in a later cascade layer, greyed out the 4px
			     state edge — the one thing the card exists to show. -->
			<button
				type="button"
				onclick={() => {
					intents.selectedId = intent.id
					preview = null
					skillView = null
					shell.detail = true
				}}
				class="rounded-xl border text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {sel
					? `border-transparent px-4 py-3 ${accent.fill}`
					: `border-l-[4px] border-foreground/5 bg-surface-raised px-4 py-3 hover:bg-surface-card-hover ${accent.edge}`}"
			>
				<!-- The selected card: same size and corners as every other, filled
				     with its state's color. -->
				<!-- row 1: what it is — title, with its type on the right -->
				<div class="flex items-baseline gap-2">
					<p class="min-w-0 flex-1 font-medium leading-snug text-xs">
						{intent.title}
					</p>
					<span
						class="shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {sel
							? 'bg-white/20 text-current'
							: TYPE_BADGE}"
					>
						{intent.type}
					</span>
				</div>
				<!-- row 2: where it came from, when, and where it stands. On the
				     filled card the secondary text is the fill's foreground, dimmed. -->
				<div class="flex items-center gap-2 pt-1 {sel ? 'text-current' : ''}">
					<span class="truncate text-[0.6875rem] {sel ? 'opacity-75' : 'text-foreground/45'}"
						>{intent.source}</span
					>
					<span
						class="ml-auto shrink-0 font-mono text-[0.625rem] {sel ? 'opacity-60' : 'text-foreground/35'}"
					>
						{intent.when}
					</span>
					{#if intent.deadline}
						<span
							class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.5625rem] {sel
								? 'bg-white/25 text-current'
								: 'bg-error/10 text-error-ink'}"
						>
							{intent.deadline}
						</span>
					{/if}
				</div>
			</button>
		{/each}

		<!-- The archive: done intents rest here, folded away by default. -->
		<button
			type="button"
			onclick={() => {
			archiveOpen = !archiveOpen
		}}
			class="flex items-center gap-1.5 px-1 pt-3 text-left font-semibold text-foreground/50 text-xs uppercase tracking-wide transition-colors hover:text-foreground/80"
		>
			<svg
				viewBox="0 0 24 24"
				class="size-3 transition-transform {archiveOpen ? 'rotate-90' : ''}"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="m9 6 6 6-6 6" />
			</svg>
			Archiv · {archivedIntents.length}
		</button>
		{#if archiveOpen}
			{#each archivedIntents as intent (intent.id)}
				{@const sel = intents.selectedId === intent.id}
				<button
					type="button"
					onclick={() => {
						intents.selectedId = intent.id
						preview = null
						skillView = null
						shell.detail = true
					}}
					class="rounded-xl border border-l-[4px] border-l-foreground/20 px-4 py-3 text-left opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all hover:opacity-100 {sel
						? 'border-foreground/15 bg-surface-card-selected opacity-100'
						: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
				>
					<div class="flex items-baseline gap-2">
						<p class="min-w-0 flex-1 font-medium text-xs leading-snug">{intent.title}</p>
						<span class="shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {TYPE_BADGE}">
							{intent.type}
						</span>
					</div>
					<div class="flex items-center gap-2 pt-1">
						<span class="truncate text-[0.6875rem] text-foreground/45">{intent.source}</span>
					</div>
				</button>
			{/each}
		{/if}
	</aside>

	<!-- CENTER: activity log / artifact preview / skill stepper. -->
	<!-- The center column wears the intent's STATE as its header — the same
	     uppercase line as intents.items and SKILLS beside it, so all three
	     columns start their cards on one line. -->
	<div
		class="{shell.detail
			? 'flex'
			: 'hidden lg:flex'} relative min-h-0 min-w-0 flex-1 flex-col gap-2"
		style="margin-bottom: var(--dock-h, 0px)"
	>
		<!-- The tabs, top center, where the status line used to be: the stream,
		     then every view. One strip, two tiers of content behind it. -->
		<nav class="flex justify-center gap-1 px-1 pt-1" aria-label="Ansicht">
			{@render tab(null, 'Aktivität')}
			{#each allWindows as w (w.manifest.id)}
				{@render tab(w.manifest.id, w.manifest.name)}
			{/each}
		</nav>
		<main
			bind:this={centerEl}
			onscroll={() => {
				if (centerEl) stick = centerEl.scrollHeight - centerEl.clientHeight - centerEl.scrollTop < 48
			}}
			class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-foreground/5 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			{#if view}
				<!-- A VIEW in front: the window actor's surface, full height. -->
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					<AvenUiView actor={view.subject} {...view.props} />
				</div>
			{:else if skillView}
				<!-- SKILL FLOW STEPPER: where this skill stands for this intent. -->
				{@const skillLog = selected.log.filter((e) => e.skill === skillView?.skill)}
				<header class="flex items-center gap-3">
					<span
						class="size-2 shrink-0 rounded-full {skillView.state === 'done'
					? 'bg-success'
					: skillView.state === 'waiting'
						? 'bg-info'
						: 'bg-progress'}"
					></span>
					<div class="min-w-0">
						<h1 class="font-semibold text-lg leading-tight">{nameOf(skillView.skill)}</h1>
						<p class="text-foreground/45 text-xs">{skillView.note}</p>
					</div>
					{@render backButton()}
				</header>
				<div class="border-border border-b"></div>

				<!-- the ACTUAL template workflow (same cards as the Skills viewer),
		     the instance state overlaid: ✓ done, amber running, red waiting -->
				<div
					bind:clientWidth={sfW}
					bind:clientHeight={sfH}
					class="h-[340px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-soft/60"
				>
					{#key skillView.skill}
						{#if sfNodes.length === 0}
							<p class="flex h-full items-center justify-center text-foreground/40 text-sm">
								{nameOf(skillView.skill)}
								— Template folgt; die Instanz läuft als Teil der Inbox-Pipeline.
							</p>
						{:else}
							<SvelteFlow
								nodes={sfNodes}
								edges={sfEdges}
								nodeTypes={sfNodeTypes}
								fitView
								minZoom={0.15}
								proOptions={{ hideAttribution: true }}
							>
								<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
								<FitView w={sfW} h={sfH} />
							</SvelteFlow>
						{/if}
					{/key}
				</div>

				<!-- what this skill logged into the intent's stream -->
				{#if skillLog.length > 0}
					<h2 class="pt-4 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
						Log dieses Skills
					</h2>
					<ul class="flex flex-col gap-2">
						{#each skillLog as entry (entry.step)}
							<li class="flex items-baseline gap-3 text-sm">
								<span class="font-mono text-[0.625rem] text-foreground/35">{entry.when}</span>
								<span class="min-w-0 flex-1">{entry.step}</span>
								<span
									class="font-mono text-[0.625rem] {entry.state === 'done'
								? 'text-success-ink'
								: entry.state === 'waiting'
									? 'text-error-ink'
									: 'text-progress-ink'}"
								>
									{entry.state === 'done' ? '✓' : entry.state === 'waiting' ? '⏸' : '⟳'}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if preview}
				<!-- ARTIFACT PREVIEW: full width — header, a divider, the view. -->
				<header class="flex items-center gap-2">
					<span
						class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
					>
						{KIND_LABEL[preview.kind]}
					</span>
					<div class="min-w-0">
						<h1 class="truncate font-semibold text-lg leading-tight">{preview.title}</h1>
						<p class="text-foreground/45 text-xs">{preview.note}</p>
					</div>
					{@render backButton()}
				</header>
				<div class="border-border border-b"></div>

				{#if preview.kind === 'doc'}
					<div class="w-full pt-2">
						<div class="flex items-baseline justify-between pb-6">
							<span class="font-semibold text-sm">{preview.title.replace('.pdf', '')}</span>
							<span class="font-mono text-[0.625rem] text-foreground/40">Seite 1 / 2</span>
						</div>
						{#each [92, 100, 78, 96, 60] as w, i (i)}
							<div class="mb-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
						{/each}
						<div class="mt-5 rounded-lg border border-warning/35 bg-warning/12 px-4 py-3">
							<p class="font-mono text-warning-ink text-[0.625rem] uppercase tracking-wide">
								Extrahiert
							</p>
							<p class="pt-1 text-xs leading-relaxed">{preview.note}</p>
						</div>
						{#each [88, 95, 70] as w, i (i)}
							<div class="mt-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
						{/each}
					</div>
				{:else if preview.kind === 'todo'}
					<div class="w-full pt-2">
						<div class="flex items-center gap-3">
							<span
								class="flex size-5 items-center justify-center rounded-md border-2 border-foreground/20"
							></span>
							<span class="flex-1 font-medium text-sm">{preview.title}</span>
							<span class="rounded-full bg-surface-soft px-2 py-0.5 font-mono text-[0.625rem]">
								todos
							</span>
						</div>
						<p class="pt-2 pl-8 text-foreground/50 text-xs">{preview.note}</p>
					</div>
				{:else if preview.kind === 'calendar'}
					<div class="flex w-full items-center gap-4 pt-2">
						<div
							class="flex size-14 flex-col items-center justify-center rounded-xl bg-error/10 text-error-ink"
						>
							<span class="font-semibold text-lg leading-none">15</span>
							<span class="pt-0.5 font-mono text-[0.5625rem] uppercase">Sep</span>
						</div>
						<div class="min-w-0">
							<p class="font-medium text-sm">{preview.title}</p>
							<p class="pt-0.5 text-foreground/50 text-xs">{preview.note}</p>
						</div>
					</div>
				{:else if preview.kind === 'person'}
					<div class="w-full pt-2">
						<div class="flex items-center gap-4">
							<span
								class="flex size-12 items-center justify-center rounded-full bg-primary/12 font-semibold text-primary text-sm"
							>
								{preview.title.slice(0, 2).toUpperCase()}
							</span>
							<div class="min-w-0">
								<p class="font-semibold text-sm">{preview.title}</p>
								<p class="text-foreground/50 text-xs">{preview.note}</p>
							</div>
						</div>
						<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
							<div class="rounded-lg bg-surface-soft px-3 py-2">
								<span class="text-foreground/40">Bezug</span><br>3 Intents · 2 Dokumente
							</div>
							<div class="rounded-lg bg-surface-soft px-3 py-2">
								<span class="text-foreground/40">Zuletzt</span><br>heute · Brief eingegangen
							</div>
						</div>
					</div>
				{:else if preview.kind === 'statement'}
					<div class="w-full pt-2">
						{#each [{ d: '28.07.', t: 'Miete August', a: '−1.150,00 €', m: 'abgeglichen ✓' }, { d: '25.07.', t: 'Möbelhaus Nord GmbH', a: '−249,00 €', m: 'Rechnung zugeordnet ✓' }, { d: '24.07.', t: 'Gehalt', a: '+3.480,00 €', m: '' }] as row (row.d + row.t)}
							<div class="flex items-center gap-3 border-border/60 border-b py-2.5 text-sm">
								<span class="w-14 font-mono text-foreground/40 text-xs">{row.d}</span>
								<span class="min-w-0 flex-1 truncate">{row.t}</span>
								<span class="font-mono {row.a.startsWith('+') ? 'text-success-ink' : ''}"
									>{row.a}</span
								>
								<span class="w-40 text-right text-[0.6875rem] text-foreground/40">{row.m}</span>
							</div>
						{/each}
					</div>
				{:else}
					<!-- brain entity: an Obsidian-style markdown note with wikilinks -->
					<div class="w-full max-w-2xl pt-2 font-mono text-[13px] leading-relaxed">
						<p class="text-foreground/35">---</p>
						<p class="text-foreground/55">
							tags: <span class="text-warning-ink">#versicherung #frist</span>
						</p>
						<p class="text-foreground/55">erstellt: 2025-08-12 · quelle: inbox</p>
						<p class="pb-3 text-foreground/35">---</p>
						<h1 class="pb-2 font-sans font-semibold text-xl">
							{preview.title.replaceAll('[', '').replaceAll(']', '')}
						</h1>
						<p class="pb-3 text-foreground/75">
							Sammelt alles rund um Versicherungen in 2025. Der Brief der
							<span
								class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
								>[[Techniker Krankenkasse]]</span
							>
							verlangt einen
							<span
								class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
								>[[Einkommensnachweis]]</span
							>
							bis zur Frist am 15.09. — das Todo hängt an
							<span
								class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
								>[[Fristen 2025]]</span
							>.
						</p>
						<p class="pb-1 text-foreground/75">## Offen</p>
						<p class="pb-0.5 text-foreground/75">
							- [ ] Nachweis einreichen <span class="text-foreground/40">(fällig 12.09.)</span>
						</p>
						<p class="pb-3 text-foreground/75">
							- [x] <span class="line-through opacity-60">Brief archivieren</span>
						</p>
						<p class="pb-1 text-foreground/75">## Verknüpft</p>
						<div class="flex flex-wrap gap-1.5 pb-4">
							{#each ['[[Techniker Krankenkasse]]', '[[Einkommensnachweis]]', '[[Fristen 2025]]', '[[Steuer 2023]]'] as link (link)}
								<span
									class="cursor-pointer rounded-md bg-primary/10 px-2 py-0.5 text-primary text-xs"
									>{link}</span
								>
							{/each}
						</div>
						<div class="border-border border-t pt-3">
							<p
								class="pb-1 font-sans font-semibold text-foreground/50 text-xs uppercase tracking-wide"
							>
								Backlinks · 3
							</p>
							<p class="text-foreground/55 text-xs">
								[[Krankenkasse: Nachweis bis 15.09.]] · [[Steuer 2023]] · [[Post-Eingang August]]
							</p>
						</div>
					</div>
				{/if}
			{:else}
				<!-- ACTIVITY LOG: the intent's journey, every entry typed by skill. -->
				<!-- The title lives on the selected card beside this panel; only where
				     the list is off screen (phones, tablets) is it repeated here. -->
				<header class="lg:hidden">
					<div class="flex items-center gap-2">
						<span class="rounded-full px-2 py-0.5 font-mono text-[0.625rem] {TYPE_BADGE}">
							{selected.type}
						</span>
						{#if selected.deadline}
							<span
								class="rounded-full bg-error/10 px-2 py-0.5 font-mono text-error-ink text-[0.625rem]"
							>
								{selected.deadline}
							</span>
						{/if}
					</div>
					<h1 class="pt-2 font-semibold text-xl leading-tight">{selected.title}</h1>
					<p class="pt-1 text-foreground/45 text-xs">{selected.source} · {selected.when}</p>
				</header>

				<ol class="flex flex-col">
					{#each logEntries as entry, i (entry.step + i)}
						<li class="relative flex gap-3 pb-5">
							{#if i < selected.log.length - 1}
								<span class="absolute top-6 bottom-0 left-[11px] w-px bg-foreground/10"></span>
							{/if}
							<span
								class="z-10 mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full {DOT[
							entry.state
						]}"
							>
								{#if entry.state === 'done'}
									<svg
										viewBox="0 0 24 24"
										class="size-3"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="m5 13 4 4L19 7" />
									</svg>
								{:else if entry.state === 'running'}
									<svg
										viewBox="0 0 24 24"
										class="size-3"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
									>
										<path d="M21 12a9 9 0 1 1-6.2-8.56" />
									</svg>
								{:else}
									<svg
										viewBox="0 0 24 24"
										class="size-3"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
									>
										<circle cx="12" cy="12" r="9" />
										<path d="M12 7v5l3 3" />
									</svg>
								{/if}
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-baseline gap-2">
									<span class="font-medium text-sm">{entry.step}</span>
									<!-- the entry is TYPED: which skill wrote it -->
									<button
										type="button"
										onclick={() => {
									skillView = selected.skills.find((s) => s.skill === entry.skill) ?? null
									preview = null
								}}
										class="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.5625rem] text-foreground/55 transition-colors hover:bg-surface-card-selected"
									>
										{nameOf(entry.skill)}
									</button>
									<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/35">
										{entry.when}
									</span>
								</div>
								{#if entry.note}
									<p class="pt-0.5 text-foreground/50 text-xs leading-relaxed">{entry.note}</p>
								{/if}
								{#if entry.card}
									<div class="mt-2 rounded-xl border border-border bg-surface-card px-4 py-3">
										<p class="font-medium text-xs">{entry.card.title}</p>
										<p class="pt-1 text-foreground/55 text-xs leading-relaxed">
											{entry.card.text}
										</p>
										{#if entry.hitl}
											<p class="pt-2 font-mono text-error-ink text-[0.625rem]">
												→ wartet in der globalen Freigabe-Leiste über der Voice-Pill
											</p>
										{/if}
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ol>

				<!-- THE CONVERSATION, continuing the stream: this intent's own
				     session — what you said and what the system said back, the
				     views it put on screen, what its tools just did. -->
				{#if chat.turns.length > 0 || activity.current}
					<div class="flex flex-col gap-2 border-foreground/10 border-t pt-4">
						{#each chat.turns as turn (turn.id)}
							<div class="flex" class:justify-end={turn.role === 'user'}>
								<div
									class="max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-xs leading-relaxed {turn.role ===
									'user'
										? 'bg-primary text-primary-foreground'
										: 'border border-border bg-surface-card'}"
								>
									{#if turn.content === '' && turn.role === 'assistant' && chat.streaming}
										<span class="flex items-center gap-1 py-1" aria-label="Denkt nach">
											<span
												class="size-1.5 animate-bounce rounded-full bg-current opacity-40"
											></span>
											<span
												class="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:150ms]"
											></span>
											<span
												class="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:300ms]"
											></span>
										</span>
									{:else}
										{turn.content}
									{/if}
								</div>
							</div>
						{/each}

						{#if activity.current}
							{@const entry = activity.current}
							<div class="flex gap-2 rounded-xl border border-border bg-surface-card px-3 py-2">
								<span
									class="w-3 shrink-0 text-center font-mono text-[13px]"
									class:text-success={entry.kind === 'done' || entry.kind === 'created'}
									class:text-progress-ink={entry.kind === 'doing'}
									class:text-error={entry.kind === 'deleted' || entry.kind === 'failed'}
									class:opacity-30={entry.kind === 'read' ||
									entry.kind === 'reopened' ||
									entry.kind === 'renamed'}
								>
									{ACTIVITY_LABELS[entry.kind].mark}
								</span>
								<div class="min-w-0 flex-1 text-xs leading-relaxed">
									<span class="opacity-40">{ACTIVITY_LABELS[entry.kind].label}</span>
									{#if entry.titles.length > 0}
										<ul class="pt-0.5">
											{#each entry.titles as title (title)}
												<li>{title}</li>
											{/each}
										</ul>
									{:else if entry.note}
										<span class="opacity-40">· {entry.note}</span>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</main>

		<!-- THE human gate: its own card BELOW the activity card, the same width,
		     not a tenant inside it. It is about this intent, so it lives in the
		     workspace — the overlay dims it and lies over it like everything
		     else — but it is a separate thing being asked of you, and nesting it
		     inside the log made it read as one more log entry. -->
		{#if !composing}
			{#each gates as held (held.id)}
				<GatePreview {held} />
			{/each}
		{/if}

		<!-- THE COMPOSER: the same card, the same slot as the human gate — flush
		     under the log — because it is the same kind of thing: a moment
		     where the stream waits on you. It is there while you write, while
		     words arrive, and while a sent request is being ROUTED: then the
		     text stays here, read-only, with the spinner in the send slot, until
		     the model has understood it and it settles into the right stream.
		     Compact: no footer — one round send button in the corner. -->
		{#if composing}
			<form
				onsubmit={(e) => {
					e.preventDefault()
					composer.send()
				}}
				class="relative w-full overflow-hidden rounded-2xl border-2 border-primary bg-surface-raised shadow-[0_4px_16px_rgba(30,41,59,0.12)]"
			>
				{#if chat.routing !== null}
					<p
						class="min-h-12 whitespace-pre-wrap py-3 pr-14 pl-4 text-[13px] text-foreground/60 leading-relaxed"
						aria-live="polite"
					>
						{chat.routing}
					</p>
					<span
						title="wird zugeordnet"
						aria-label="wird zugeordnet"
						class="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary/10"
					>
						<span
							class="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
						></span>
					</span>
				{:else}
					<textarea
						bind:this={composerEl}
						bind:value={composer.draft}
						onkeydown={onComposerKeydown}
						onblur={() => composer.dismiss()}
						rows="1"
						placeholder="Sprich — oder schreib…"
						class="field-sizing-content max-h-60 min-h-12 w-full resize-none bg-transparent py-3 pr-14 pl-4 text-[13px] text-foreground/80 leading-relaxed outline-none placeholder:text-foreground/35"
					></textarea>
					<button
						type="submit"
						disabled={composer.draft.trim() === ''}
						onmousedown={(e) => e.preventDefault()}
						title="Senden"
						aria-label="Senden"
						class="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-30"
					>
						<svg
							viewBox="0 0 24 24"
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 19V5" />
							<path d="m5 12 7-7 7 7" />
						</svg>
					</button>
				{/if}
			</form>
		{/if}
	</div>

	<!-- RIGHT: SKILLS (click → stepper) above ARTIFACTS (click → preview).
	     On phones it is a drawer sliding in from the right over the detail,
	     opened by the header toggle; a backdrop tap closes it. -->
	{#if shell.rightOpen}
		<button
			type="button"
			aria-label="Schließen"
			onclick={() => {
				shell.rightOpen = false
			}}
			class="fixed inset-0 z-30 bg-foreground/30 lg:hidden"
		></button>
	{/if}
	<aside
		class="{shell.rightOpen
			? 'fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] border-border border-l bg-surface-raised p-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-2xl'
			: 'hidden'} min-h-0 shrink-0 flex-col gap-2 overflow-y-auto pb-2 lg:static lg:flex lg:w-72 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
	>
		<h2 class="flex justify-center px-1 pt-1">
			<span
				class="rounded-full border border-foreground/10 px-3 py-1 font-medium text-foreground/60 text-xs"
			>
				Skills · {selected.skills.length}
			</span>
		</h2>
		{#each selected.skills as s (s.skill)}
			<button
				type="button"
				onclick={() => {
			skillView = skillView?.skill === s.skill ? null : s
			preview = null
			shell.rightOpen = false
		}}
				class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {skillView?.skill ===
		s.skill
			? 'border-foreground/15 bg-surface-card-selected'
			: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
			>
				<div class="flex items-center gap-2">
					<span
						class="size-1.5 shrink-0 rounded-full {s.state === 'done'
					? 'bg-success'
					: s.state === 'waiting'
						? 'bg-info'
						: 'bg-progress'}"
					></span>
					<span class="font-medium text-xs">{nameOf(s.skill)}</span>
					<span class="ml-auto font-mono text-[0.625rem] text-foreground/40">
						{s.state === 'done' ? 'fertig' : s.state === 'waiting' ? 'wartet' : 'läuft'}
					</span>
				</div>
				<p class="pt-1 text-[0.6875rem] text-foreground/50 leading-relaxed">{s.note}</p>
			</button>
		{/each}

		<h2
			class="px-1 pt-3 text-center font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Artefakte · {selected.artifacts.length}
		</h2>
		{#each selected.artifacts as artifact (artifact.title)}
			<button
				type="button"
				onclick={() => {
			preview = preview?.title === artifact.title ? null : artifact
			skillView = null
			shell.rightOpen = false
		}}
				class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {preview?.title ===
		artifact.title
			? 'border-foreground/15 bg-surface-card-selected'
			: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
			>
				<div class="flex items-center gap-2">
					<span
						class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
					>
						{KIND_LABEL[artifact.kind]}
					</span>
					<div class="min-w-0">
						<p class="truncate font-medium text-xs">{artifact.title}</p>
						<p class="truncate text-[0.6875rem] text-foreground/45">{artifact.note}</p>
					</div>
				</div>
			</button>
		{/each}

		<p class="px-1 pt-2 text-[0.625rem] text-foreground/35 leading-relaxed">
			Ein Intent kombiniert Artefakte und Skill-Flows, um eine Aufgabe zu lösen. Alles hier ist ein
			Mock — die Pipeline (ingest → classify → intents → skill-flows) kommt später.
		</p>
	</aside>
</div>
