<script lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ActorExplorer from '$lib/actors/ActorExplorer.svelte'
import { ACTIVITY_LABELS, activity } from '$lib/actors/activity.svelte'
import { bus } from '$lib/actors/bus'
import { chatActor, negotiatorActor, stopWork, summarizeCall } from '$lib/actors/chat.actor.svelte'
import { confirmHeld, hitlQueue, rejectHeld } from '$lib/actors/hitl.svelte'
import { listenerActor } from '$lib/actors/listener.actor.svelte'
import { registryTick } from '$lib/actors/reactivity.svelte'
import { speakerActor } from '$lib/actors/speaker.actor.svelte'
import { isWindow } from '$lib/actors/window.actor.svelte'
import { windowsBound } from '$lib/actors/windows'
import FibuExplorer from '$lib/fibu/FibuExplorer.svelte'
import RecipeFlow from '$lib/fibu/RecipeFlow.svelte'
import IntentExplorer from '$lib/intents/IntentExplorer.svelte'

/**
 * Dashboard — a chat against RedPill's confidential Gemma
 * (`phala/gemma-4-31b-it`), streamed token by token, spoken aloud in German by
 * Supertonic as it arrives, and listened to with Nemotron + Silero VAD.
 *
 * The split is deliberate: the brain is remote and attested, the voice is
 * entirely on-device.
 */

/**
 * The page constructs nothing. The mesh assembles itself in the actor
 * modules — registration, contracts, the emit wiring — and this file merely
 * renders the actors' state. The aliases keep the template readable.
 */
const speaker = speakerActor.core
const chat = chatActor.core
const listener = listenerActor.core

/**
 * Which surface fills the middle of the screen. Views are exactly that in
 * the actor world: renderings over actor state, owning nothing — the work
 * items view is the first. Actors is the registry itself; Chat is how work
 * gets asked for. The view is the default because the workspace is the
 * point.
 */
let tab = $state<'views' | 'actors' | 'chat' | 'fibu' | 'skills' | 'intents'>('views')

/** The workspaces that want the whole window rather than reading width. */
const wide = $derived(tab === 'fibu' || tab === 'skills' || tab === 'intents')

/**
 * Voice is the default, except where there is no voice.
 *
 * In a plain browser tab the recognizer is unavailable, and starting in voice
 * mode there means an empty panel with no way to say anything until you find
 * the icon. Text is the only mode that works, so it is the one to start in.
 */
let typing = $state(!isTauri())

// Hands-free by default: the mic opens as soon as the page does.
//
// `onMount`, emphatically not `$effect`. An effect tracks what its body reads,
// and `start()` both reads and writes `listener.status` — so the write
// invalidated the effect, the cleanup tore the audio graph down, and it started
// over, forever. The microphone was genuinely open the whole time (macOS even
// showed the orange indicator), but the worklet never survived long enough to
// deliver a single batch.
onMount(() => {
	void listener.start()
	return () => listener.stop()
})

// The recognizer needs to know when its own voice is in the room. Reading
// `speaker.speaking` is the tracked dependency; `setOutputActive` writes no
// reactive state, so this cannot feed back into itself.
$effect(() => {
	listener.setOutputActive(speaker.speaking)
})

/**
 * One state for the whole conversation, instead of one per component.
 *
 * The pieces each know their own status, but what you actually want to see is
 * whose turn it is — and the order matters: speaking wins over thinking because
 * the reply is still streaming while the first sentence is already being read
 * out, and hearing wins over everything because interrupting is allowed.
 */
const phase = $derived.by(() => {
	if (listener.status === 'denied') return { key: 'denied', label: 'No microphone' }
	if (listener.status === 'error' || speaker.status === 'error')
		return { key: 'error', label: 'Error' }
	// A sentence that fails to synthesize does not stop the voice for good, so it
	// keeps `status` — but it must not just go quiet either, which is
	// indistinguishable from the voice being broken.
	if (speaker.failure) return { key: 'error', label: `Voice: ${speaker.failure}` }
	if (speaker.status === 'preparing')
		return { key: 'loading', label: `Voice loading ${Math.round(speaker.progress * 100)}%` }
	if (listener.status === 'preparing')
		return listener.stage === 'load'
			? { key: 'starting', label: 'Ears starting…' }
			: { key: 'loading', label: `Ears loading ${Math.round(listener.progress * 100)}%` }
	if (listener.speech) return { key: 'hearing', label: 'Listening' }
	// Audio output that never got a user gesture. Saying "Spricht" over a sleeping
	// device is the one state that gives you nothing to act on — this one you can
	// tap, and one tap fixes it for the rest of the session.
	if (speaker.output === 'suspended') return { key: 'blocked', label: 'Enable audio' }
	if (speaker.speaking) return { key: 'speaking', label: 'Speaking' }
	if (chat.streaming) return { key: 'thinking', label: 'Thinking' }
	if (listener.status === 'listening') return { key: 'idle', label: 'Ready' }
	return { key: 'text', label: 'Text only' }
})

let draft = $state('')
/** Flips briefly after an export so the button itself confirms the copy. */
let exported = $state(false)

/**
 * The session as JSON on the clipboard — model, the exact wire messages
 * (tool_calls, arguments, results by id), and the rendered turns. Made to be
 * pasted into a debugging session when a flow went sideways, so the fix can
 * start from what the model actually saw instead of a retelling.
 */
async function exportLog() {
	const log = JSON.stringify(
		{
			model: 'qwen/qwen3.5-122b-a10b',
			exportedAt: new Date().toISOString(),
			...(chat.export() as object)
		},
		null,
		2
	)
	try {
		await navigator.clipboard.writeText(log)
	} catch {
		// Clipboard denied (unfocused window, old webview) — download instead.
		const url = URL.createObjectURL(new Blob([log], { type: 'application/json' }))
		const a = document.createElement('a')
		a.href = url
		a.download = 'aven-chat-log.json'
		a.click()
		URL.revokeObjectURL(url)
	}
	exported = true
	setTimeout(() => {
		exported = false
	}, 2000)
}
let log: HTMLDivElement | null = $state(null)
let form: HTMLFormElement | null = $state(null)

function submit(event: SubmitEvent) {
	event.preventDefault()
	// The send click is the user gesture the audio device needs; without it the
	// first reply would synthesize into a suspended context and never be heard.
	speaker.resumeAudio()
	const text = draft
	draft = ''
	chat.send(text)
}

/** Enter sends, shift+enter makes a newline — the usual bargain. */
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		form?.requestSubmit()
	}
}

// Follow the stream. Reading `turns` and the last turn's content is what makes
// this re-run on every token, not just on every message.
$effect(() => {
	const last = chat.turns.at(-1)
	void chat.turns.length
	void last?.content
	log?.scrollTo({ top: log.scrollHeight })
})
</script>

<svelte:head>
	<title>Dashboard · avenOS</title>
</svelte:head>

<!-- Buchhaltung und Skills sind Arbeitsflächen im Inbox-Layout und bekommen
     die volle Fensterbreite; die übrigen Tabs bleiben auf Lesebreite zentriert.
     Ein einziges 8px-Raster (gap-2/p-2) trägt alle Abstände: Fensterkante →
     Tabs → Fläche → Voice-Panel → Fensterkante. -->
<main
	class="mx-auto flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 {wide
		? 'w-full max-w-none'
		: 'max-w-6xl'}"
>
	<header class="flex flex-col items-center">
		<!-- Compact tabs, centred: the skills workspace and the conversation. -->
		<nav class="flex gap-0.5 rounded-full border border-border p-0.5 text-xs">
			{#each [{ id: 'views' as const, label: 'Views' }, { id: 'actors' as const, label: 'Actors' }, { id: 'chat' as const, label: 'Chat' }, { id: 'fibu' as const, label: 'Buchhaltung' }, { id: 'skills' as const, label: 'Skills' }, { id: 'intents' as const, label: 'Intents' }] as t (t.id)}
				<button
					type="button"
					onclick={() => {
						tab = t.id
					}}
					class="rounded-full px-3 py-1 transition-colors {tab === t.id
						? 'bg-primary text-primary-foreground'
						: 'opacity-60 hover:opacity-100'}"
				>
					{t.label}
				</button>
			{/each}
		</nav>
	</header>

	{#if tab === 'chat'}
		<div class="flex min-h-0 flex-1 flex-col gap-2">
			<!-- Chat-scoped actions: they operate on this conversation, so they
				     live with it rather than in the global chrome. -->
			{#if chat.turns.length > 0}
				<div class="flex justify-end gap-3 text-xs opacity-50">
					<button type="button" class="underline underline-offset-4" onclick={exportLog}>
						{exported ? 'Copied' : 'Export'}
					</button>
					<button
						type="button"
						class="underline underline-offset-4"
						onclick={() => {
								chat.clear()
								speaker.silence()
								activity.clear()
								void listener.reset()
							}}
					>
						Clear
					</button>
				</div>
			{/if}

			<div bind:this={log} class="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto">
				{#each chat.turns as turn (turn.id)}
					<div class="flex flex-col gap-1" class:items-end={turn.role === 'user'}>
						<!-- What the turn's tools actually did, kept with the reply they
				     produced. The toast is the glance; this is the record. -->
						{#each turn.calls ?? [] as call, i (i)}
							{@const entry = summarizeCall(call.name, call.result)}
							{#if entry}
								<div class="flex gap-2 pl-1 text-xs opacity-60">
									<span
										class="w-3 shrink-0 text-center font-mono"
										class:text-status-success={entry.kind === 'done' || entry.kind === 'created'}
										class:text-status-working={entry.kind === 'doing'}
										class:text-status-error={entry.kind === 'deleted' || entry.kind === 'failed'}
									>
										{ACTIVITY_LABELS[entry.kind].mark}
									</span>
									<span class="min-w-0">
										{ACTIVITY_LABELS[entry.kind].label}
										{entry.titles.length > 0
									? `: ${entry.titles.join(', ')}`
									: entry.note
										? ` · ${entry.note}`
										: ''}
									</span>
								</div>
							{/if}
						{/each}
						<div
							class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed"
							class:bg-primary={turn.role === 'user'}
							class:text-primary-foreground={turn.role === 'user'}
							class:bg-surface-card={turn.role === 'assistant'}
							class:border={turn.role === 'assistant'}
							class:border-border={turn.role === 'assistant'}
						>
							{#if turn.content === '' && turn.role === 'assistant' && chat.streaming}
								<!-- Thinking. Three dots breathing in sequence, not a frozen
						     ellipsis that reads as a hung reply. -->
								<span class="flex items-center gap-1 py-1.5" aria-label="Thinking">
									<span class="size-1.5 animate-bounce rounded-full bg-current opacity-40"></span>
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

				<!-- What is being heard right now, before the utterance closes. Sits where
	     the user bubble will land so the text does not jump when it does. -->
				{#if listener.partial !== ''}
					<div class="flex justify-end">
						<div
							class="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-dashed border-border px-4 py-3 text-sm leading-relaxed opacity-50"
						>
							{listener.partial}
						</div>
					</div>
				{/if}

				{#if chat.failure || speaker.failure || listener.failure}
					<p
						class="rounded-2xl border border-status-error/30 bg-status-error-muted px-4 py-3 text-sm text-status-error-strong"
					>
						{chat.failure ?? speaker.failure ?? listener.failure}
					</p>
				{/if}
			</div>
		</div>
	{:else if tab === 'fibu'}
		<!-- FiBu, hardcoded and read-only (board 0139): the lowest booking
		     primitive — Rechnungsposition → Buchungszeilen — over mock data,
		     deliberately outside the actor/vibe world. -->
		<div class="flex min-h-0 w-full flex-1 flex-col">
			<FibuExplorer />
		</div>
	{:else if tab === 'intents'}
		<!-- Intent-Cockpit (UX-Brainstorm, hartkodiert): alles ist ein Intent;
		     je Intent arbeiten parallele Skill-Läufe — geteilter Rahmen
		     (Stepper, Abhängigkeiten, Zustand), eigenes Gesicht pro Skill. -->
		<div class="flex min-h-0 w-full flex-1 flex-col">
			<IntentExplorer />
		</div>
	{:else if tab === 'skills'}
		<!-- The skill library (board 0140): flows as JSON configs on a canvas,
		     grouped by the skills that bring them. No engine — declarations. -->
		<div class="flex min-h-0 w-full flex-1 flex-col">
			<RecipeFlow />
		</div>
	{:else if tab === 'actors'}
		<!-- The actor explorer: everything the registry knows about every actor,
		     template and instance kept as the two concepts they are. -->
		<div class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
			<ActorExplorer />
		</div>
	{:else}
		<!-- Views, derived from the registry: every OPEN window actor renders
		     its component over its subject's state. Windows are actors — the
		     model toggles them by message, the explorer interviews them.
		     (windowsBound imports the bindings.) -->
		<!-- overflow-y-auto is load-bearing: without it a tall window (the
		     mockup's live preview) overflows UNDER the voice pill instead of
		     scrolling; the bottom padding lets the last content clear it. -->
		<div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto pb-8">
			{#if windowsBound && registryTick.v >= 0}
				{#each bus.actors().filter(isWindow).filter((w) => w.open) as w (w.manifest.id)}
					{@const Face = w.component as import('svelte').Component<{ actor: typeof w.subject }>}
					<section class="flex min-h-0 flex-col rounded-2xl">
						<!-- Centered under the tab pill; the close sits quietly on the right. -->
						<div class="relative flex items-baseline justify-center gap-2 pb-2">
							<span class="font-semibold text-[15px]">{w.manifest.name}</span>
							<span class="font-mono text-[0.625rem] text-foreground/35">
								{w.subject.manifest.id}
							</span>
							<button
								type="button"
								onclick={() => {
									w.open = false
								}}
								title="Hide window"
								aria-label="Hide window"
								class="absolute top-0 right-0 text-foreground/30 transition-colors hover:text-foreground"
							>
								×
							</button>
						</div>
						<Face actor={w.subject} {...w.props} />
					</section>
				{:else}
					<p class="pt-10 text-center text-foreground/40 text-sm">
						No window open. Say, for example,
						{#each bus.actors().filter(isWindow) as w, i (w.manifest.id)}
							{i > 0 ? ' oder' : ''}
							"show {w.manifest.name}"
						{/each}
					</p>
				{/each}
			{/if}
		</div>
	{/if}

	<!-- What the tools just did, as a toast. One at a time, three seconds: a
	     glance to confirm the list changed the way you meant, not a log to read.
	     Reserving the space keeps the input panel still as toasts come and go;
	     bottom-aligned in it, so the toast hugs the panel it belongs to. The
	     toast carries the content, so it keeps the full width; in voice mode the
	     panel below it narrows instead, holding only a status word and two
	     buttons. The FiBu workspace drops the strip entirely — the inbox layout
	     wants every pixel of height, and even an empty flex child would double
	     the gap between the view and the panel. -->
	{#if !wide}
		<div class="mx-auto flex min-h-16 w-full max-w-lg items-end justify-center">
			{#if listener.partial !== '' && tab !== 'chat'}
				<!-- What is being heard, as it is being heard — the live recognizer
			     output, so you can watch your words arrive while the list view is
			     open. Dashed like the transcript's own pending bubble. -->
				<div
					class="w-full rounded-xl border border-border border-dashed bg-surface-card px-4 py-3 text-xs opacity-70"
				>
					{listener.partial}
				</div>
			{:else if activity.current}
				{@const entry = activity.current}
				<div
					class="flex w-full gap-2 rounded-xl border border-border bg-surface-card px-4 py-3 text-xs"
				>
					<span
						class="w-3 shrink-0 text-center font-mono"
						class:text-status-success={entry.kind === 'done' || entry.kind === 'created'}
						class:text-status-working={entry.kind === 'doing'}
						class:text-status-error={entry.kind === 'deleted' || entry.kind === 'failed'}
						class:opacity-30={entry.kind === 'read' ||
						entry.kind === 'reopened' ||
						entry.kind === 'renamed'}
					>
						{ACTIVITY_LABELS[entry.kind].mark}
					</span>
					<div class="min-w-0 flex-1">
						<span class="opacity-40">{ACTIVITY_LABELS[entry.kind].label}</span>
						{#if entry.titles.length > 0}
							<!-- One per line. Run together with separators, five items became
						     a sentence that ran off the edge and told you nothing. -->
							<ul class="pt-0.5">
								{#each entry.titles as title (title)}
									<li class="leading-relaxed">{title}</li>
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

	<!-- THE human gate, universal: every held message — a destructive tool
	     call, a drafted bridge — surfaces HERE, above the voice pill, and
	     resolves only by a physical button press. Voice cannot confirm. -->
	{#each hitlQueue.items as held (held.id)}
		<div
			class="mx-auto mb-2 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-foreground/10 bg-[#fffdf7] px-4 py-2.5 shadow-[0_4px_16px_rgba(30,41,59,0.08)]"
		>
			<div class="min-w-0 flex-1">
				<p class="font-medium text-sm">{held.label}</p>
				<p class="truncate font-mono text-[0.6875rem] text-foreground/45">
					{held.actor}
					· {held.method} · {held.detail}
				</p>
			</div>
			<button
				type="button"
				onclick={() => confirmHeld(held.id)}
				class="shrink-0 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm"
			>
				Confirm
			</button>
			<button
				type="button"
				onclick={() => rejectHeld(held.id)}
				class="shrink-0 rounded-full border border-foreground/10 px-4 py-1.5 font-medium text-foreground/60 text-sm"
			>
				Reject
			</button>
		</div>
	{/each}
	{#if negotiatorActor.state.pending}
		{@const draftPending = negotiatorActor.state.pending as { id: string; description: string }}
		<div
			class="mx-auto mb-2 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-foreground/10 bg-[#fffdf7] px-4 py-2.5 shadow-[0_4px_16px_rgba(30,41,59,0.08)]"
		>
			<div class="min-w-0 flex-1">
				<p class="font-medium text-sm">
					Bridge draft: <span class="font-mono">{draftPending.id}</span>
				</p>
				<p class="truncate text-[0.75rem] text-foreground/50">{draftPending.description}</p>
			</div>
			<button
				type="button"
				onclick={() => {
					void bus.uiEvent('hitl', 'negotiator', { send: 'APPROVE' })
				}}
				class="shrink-0 rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-sm"
			>
				Approve
			</button>
			<button
				type="button"
				onclick={() => {
					void bus.uiEvent('hitl', 'negotiator', { send: 'REJECT' })
				}}
				class="shrink-0 rounded-full border border-foreground/10 px-4 py-1.5 font-medium text-foreground/60 text-sm"
			>
				Reject
			</button>
		</div>
	{/if}
	<!-- One panel: what the system is doing, and how you talk to it. Dark, so it
	     reads as the active surface rather than another card on a pale page. -->
	<div
		class="mx-auto w-full rounded-full bg-primary py-2.5 pr-2.5 pl-5 text-primary-foreground {typing
			? 'max-w-lg'
			: 'max-w-72'}"
		title="Silero VAD · Nemotron 3.5 (de-DE) · Supertonic-3 M5 — all on-device"
	>
		<div class="flex items-center gap-3">
			{#if typing}
				<form bind:this={form} onsubmit={submit} class="flex flex-1 items-center gap-2">
					<textarea
						bind:value={draft}
						onkeydown={onKeydown}
						rows="1"
						placeholder="Write…"
						class="field-sizing-content max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-primary-foreground/40"
					></textarea>
					<!-- Same shape as the mode toggle next to it, so the panel ends in a
					     matched pair of round icon buttons rather than a word and a circle. -->
					<button
						type="submit"
						disabled={draft.trim() === ''}
						title="Send"
						aria-label="Send"
						class="shrink-0 rounded-full border border-primary-foreground/25 p-2 transition-all hover:bg-primary-foreground/10 disabled:opacity-30 disabled:hover:bg-transparent"
					>
						<!-- arrow up: send -->
						<svg
							viewBox="0 0 24 24"
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 19V5" />
							<path d="m5 12 7-7 7 7" />
						</svg>
					</button>
				</form>
			{:else}
				<!-- While listening the dot follows the microphone level, so a dead
				     input is visible as a dot that never moves. -->
				<span
					class="inline-block size-2 shrink-0 rounded-full transition-transform"
					class:bg-status-error={phase.key === 'hearing' || phase.key === 'idle'}
					class:bg-status-success={phase.key === 'speaking'}
					class:bg-status-working={phase.key === 'thinking' ||
						phase.key === 'loading' ||
						phase.key === 'starting'}
					class:bg-primary-foreground={phase.key === 'denied' || phase.key === 'text'}
					class:animate-pulse={phase.key === 'thinking' ||
						phase.key === 'loading' ||
						phase.key === 'starting'}
					style={phase.key === 'hearing' || phase.key === 'idle'
						? `transform: scale(${1 + Math.min(listener.level, 1) * 2})`
						: ''}
				></span>
				{#if phase.key === 'blocked'}
					<!-- The whole label is the button. There is nothing else to do in this
					     state, and a separate control next to it would just be a second
					     thing to read before the obvious one. -->
					<button
						type="button"
						onclick={() => speaker.resumeAudio()}
						class="flex-1 text-left text-sm underline underline-offset-4"
					>
						{phase.label}
					</button>
				{:else}
					<span class="flex-1 text-sm">{phase.label}</span>
				{/if}
				{#if chat.streaming || speaker.speaking}
					<!-- Same circle as its neighbours, but filled: it is the one action
					     that matters while the assistant is talking, so it gets the
					     inverted colors instead of an outline. -->
					<button
						type="button"
						onclick={() => {
							// The button stops EVERYTHING: the reply stream AND the work
							// lane (compose chains, negotiation drafts). Barge-in by voice
							// stops only the reply — work survives the user talking.
							chat.stop()
							stopWork()
							speaker.silence()
						}}
						title="Stop"
						aria-label="Stop"
						class="shrink-0 rounded-full bg-status-error p-2 text-primary-foreground transition-opacity hover:opacity-80"
					>
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor">
							<rect x="7" y="7" width="10" height="10" rx="1.5" />
						</svg>
					</button>
				{/if}
			{/if}

			<!-- Only where there is something to switch to. In the browser there is
			     no recognizer at all, so text is not a mode there — it is the whole
			     interface, and a button offering to leave it leads nowhere. -->
			{#if isTauri()}
				<!-- An icon rather than a word: it sits next to live status text, and a
				     second label there reads as another thing to be understood. -->
				<button
					type="button"
					onclick={() => {
						typing = !typing
					}}
					class="shrink-0 rounded-full border border-primary-foreground/25 p-2 transition-colors hover:bg-primary-foreground/10"
					title={typing ? 'Back to voice' : 'Type instead'}
					aria-label={typing ? 'Back to voice' : 'Type instead'}
				>
					{#if typing}
						<!-- microphone: go back to speaking -->
						<svg
							viewBox="0 0 24 24"
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
							<path d="M5 11a7 7 0 0 0 14 0" />
							<path d="M12 18v3" />
						</svg>
					{:else}
						<!-- keyboard: switch to typing -->
						<svg
							viewBox="0 0 24 24"
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="2.5" y="6" width="19" height="12" rx="2" />
							<path d="M7 10h.01M11 10h.01M15 10h.01M17.5 10h.01M7.5 14h9" />
						</svg>
					{/if}
				</button>
			{/if}
		</div>

		{#if phase.key === 'loading'}
			<div class="mt-3 h-1 overflow-hidden rounded-full bg-primary-foreground/20">
				<div
					class="h-full rounded-full bg-primary-foreground transition-[width]"
					style="width: {Math.round(
						(listener.status === 'preparing' ? listener.progress : speaker.progress) * 100
					)}%"
				></div>
			</div>
		{/if}
	</div>
</main>
