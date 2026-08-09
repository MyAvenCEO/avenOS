<script lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import { onMount } from 'svelte'
import ActorsFlowView from '$lib/actors/ActorsFlowView.svelte'
import type { Activity } from '$lib/actors/activity.svelte'
import { ACTIVITY_LABELS, ToolActivity } from '$lib/actors/activity.svelte'
import { bus } from '$lib/actors/bus'
import { SEED_ACTORS } from '$lib/actors/seed'
import WorkItemsView from '$lib/actors/WorkItemsView.svelte'
import { workItems } from '$lib/actors/workitems.svelte'
import { Listener } from '$lib/asr/listener.svelte'
import { Chat } from '$lib/chat/chat.svelte'
import { streamChat } from '$lib/chat/redpill'
import { Speaker } from '$lib/tts/speaker.svelte'

/**
 * Dashboard — a chat against RedPill's confidential Gemma
 * (`phala/gemma-4-31b-it`), streamed token by token, spoken aloud in German by
 * Supertonic as it arrives, and listened to with Nemotron + Silero VAD.
 *
 * The split is deliberate: the brain is remote and attested, the voice is
 * entirely on-device.
 */

const speaker = new Speaker()

/**
 * The registry: everything the dashboard can do is an actor on the bus.
 * WorkItems is real; the intent-router chain is seeded as contract-carrying
 * stubs so the mesh has its shape before the execution engine exists.
 */
bus.register(workItems)
for (const actor of SEED_ACTORS) bus.register(actor)

// The one LLM in the system, injected once. Only ask() may reach it —
// ordinary messages stay deterministic.
bus.llm = async (system, question) => {
	let text = ''
	for await (const event of streamChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: question }
		],
		[]
	)) {
		if (event.kind === 'text') text += event.text
	}
	return text
}

const activity = new ToolActivity()

/** One displayable entry for a call — the owning actor knows its own words. */
function summarizeCall(name: string, record: string): Omit<Activity, 'id'> | null {
	if (name === 'actor_ask') {
		try {
			const parsed = JSON.parse(record)
			return { kind: 'asked', titles: [String(parsed.actor ?? '')], note: undefined }
		} catch {
			return null
		}
	}
	return workItems.summarize(name, record)
}

// Every delta goes to the bubble and to the speaker at the same time, so the
// first sentence is usually being read out while the model is still writing.
const chat = new Chat(
	{
		onDelta: (text) => speaker.feed(text),
		onDone: () => speaker.flush(),
		// Tool calls mean the real answer is still coming; unsay the placeholder.
		onRestart: () => speaker.silence()
	},
	// The model's tools ARE the registry: specs derive from manifests, a call
	// becomes an ordinary envelope on the bus. Register an actor, the model
	// can call it.
	{
		specs: bus.toolSpecs().map(({ name, description, parameters }) => ({
			name,
			description,
			parameters
		})),
		run: async (name, args) => {
			let payload: Record<string, unknown> = {}
			try {
				payload = args.trim() === '' ? {} : JSON.parse(args)
			} catch {
				const record = JSON.stringify({ ok: false, error: `unlesbare Argumente: ${args}` })
				return { record, wire: `unlesbare Argumente` }
			}
			if (name === 'actor_ask') {
				const answer = await bus.ask(String(payload.actor ?? ''), String(payload.question ?? ''))
				const result = {
					record: JSON.stringify({ ok: true, actor: payload.actor, answer }),
					wire: answer
				}
				activity.show(summarizeCall(name, result.record))
				return result
			}
			const result = bus.dispatch('chat', name, payload)
			activity.show(summarizeCall(name, result.record))
			return result
		}
	}
)

/**
 * Which surface fills the middle of the screen: the skills workspace, or the
 * conversation. One Skills tab rather than one per skill — which skill it
 * shows is meant to follow the conversation automatically later; today it is
 * the only skill there is. The workspace is the default; chat is how work
 * gets asked for.
 */
let tab = $state<'skills' | 'flows' | 'chat'>('skills')

const listener = new Listener({
	// Barge-in. This fires on voice activity alone, ~64ms in, with nothing yet
	// transcribed — which is the only way interrupting feels like interrupting
	// a person rather than cancelling a download.
	onSpeechStart: () => {
		// Unconditional. Both are no-ops when idle, and the conditional version
		// could miss the window where a reply is streaming but the first sentence
		// has not reached the speaker yet — talking there left the request running
		// and the answer arrived anyway, on top of whatever was said next.
		speaker.silence()
		chat.stop()
	},
	// A finished utterance is just a message. No send button in the loop.
	onUtterance: (text) => {
		speaker.resumeAudio()
		chat.send(text)
	}
})

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
	if (listener.status === 'denied') return { key: 'denied', label: 'Kein Mikrofon' }
	if (listener.status === 'error' || speaker.status === 'error')
		return { key: 'error', label: 'Fehler' }
	// A sentence that fails to synthesize does not stop the voice for good, so it
	// keeps `status` — but it must not just go quiet either, which is
	// indistinguishable from the voice being broken.
	if (speaker.failure) return { key: 'error', label: `Stimme: ${speaker.failure}` }
	if (speaker.status === 'preparing')
		return { key: 'loading', label: `Stimme lädt ${Math.round(speaker.progress * 100)}%` }
	if (listener.status === 'preparing')
		return listener.stage === 'load'
			? { key: 'starting', label: 'Ohren starten…' }
			: { key: 'loading', label: `Ohren laden ${Math.round(listener.progress * 100)}%` }
	if (listener.speech) return { key: 'hearing', label: 'Hört zu' }
	// Audio output that never got a user gesture. Saying "Spricht" over a sleeping
	// device is the one state that gives you nothing to act on — this one you can
	// tap, and one tap fixes it for the rest of the session.
	if (speaker.output === 'suspended') return { key: 'blocked', label: 'Ton aktivieren' }
	if (speaker.speaking) return { key: 'speaking', label: 'Spricht' }
	if (chat.streaming) return { key: 'thinking', label: 'Denkt nach' }
	if (listener.status === 'listening') return { key: 'idle', label: 'Bereit' }
	return { key: 'text', label: 'Nur Text' }
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

<main class="mx-auto flex min-h-0 min-w-0 max-w-6xl flex-1 flex-col gap-4 p-4 pb-2 sm:p-6 sm:pb-3">
	<header class="flex flex-col items-center">
		<!-- Compact tabs, centred: the skills workspace and the conversation. -->
		<nav class="flex gap-0.5 rounded-full border border-border p-0.5 text-xs">
			{#each [{ id: 'skills' as const, label: 'Skills' }, { id: 'flows' as const, label: 'Flows' }, { id: 'chat' as const, label: 'Chat' }] as t (t.id)}
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
						{exported ? 'Kopiert' : 'Export'}
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
								<span class="flex items-center gap-1 py-1.5" aria-label="Denkt nach">
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
	{:else if tab === 'flows'}
		<!-- The recipe book: flow templates rendered as the rule solver reads
		     them — facts in, actor stages, goals out. aven → skills → flows →
		     actors; descriptive today, executable later. -->
		<div class="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
			<ActorsFlowView />
		</div>
	{:else}
		<!-- The skills workspace. Today that is the todo list; the plan is for
		     this surface to switch between skill views as the conversation moves.
		     3xl rather than lg: the board lays three columns side by side. -->
		<div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
			<WorkItemsView store={workItems} />
		</div>
	{/if}

	<!-- What the tools just did, as a toast. One at a time, three seconds: a
	     glance to confirm the list changed the way you meant, not a log to read.
	     Reserving the space keeps the input panel still as toasts come and go;
	     bottom-aligned in it, so the toast hugs the panel it belongs to. The
	     toast carries the content, so it keeps the full width; in voice mode the
	     panel below it narrows instead, holding only a status word and two
	     buttons. -->
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

	<!-- One panel: what the system is doing, and how you talk to it. Dark, so it
	     reads as the active surface rather than another card on a pale page. -->
	<div
		class="mx-auto -mt-2 w-full rounded-full bg-primary py-2.5 pr-2.5 pl-5 text-primary-foreground {typing
			? 'max-w-lg'
			: 'max-w-72'}"
		title="Silero VAD · Nemotron 3.5 (de-DE) · Supertonic-3 M5 — alles on-device"
	>
		<div class="flex items-center gap-3">
			{#if typing}
				<form bind:this={form} onsubmit={submit} class="flex flex-1 items-center gap-2">
					<textarea
						bind:value={draft}
						onkeydown={onKeydown}
						rows="1"
						placeholder="Schreiben…"
						class="field-sizing-content max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-primary-foreground/40"
					></textarea>
					<!-- Same shape as the mode toggle next to it, so the panel ends in a
					     matched pair of round icon buttons rather than a word and a circle. -->
					<button
						type="submit"
						disabled={draft.trim() === ''}
						title="Senden"
						aria-label="Senden"
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
							chat.stop()
							speaker.silence()
						}}
						title="Stopp"
						aria-label="Stopp"
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
					title={typing ? 'Zurück zur Sprache' : 'Stattdessen tippen'}
					aria-label={typing ? 'Zurück zur Sprache' : 'Stattdessen tippen'}
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
