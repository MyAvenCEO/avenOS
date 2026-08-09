<script lang="ts">
import { Listener } from '$lib/asr/listener.svelte'
import { Chat } from '$lib/chat/chat.svelte'
import { Todos } from '$lib/todos/store.svelte'
import { runTodoTool, TODO_TOOLS } from '$lib/todos/tools'
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

// Every delta goes to the bubble and to the speaker at the same time, so the
// first sentence is usually being read out while the model is still writing.
const todos = new Todos()

const chat = new Chat(
	{
		onDelta: (text) => speaker.feed(text),
		onDone: () => speaker.flush()
	},
	// The model manages the same list the buttons below do — there is no second
	// copy of the todos anywhere, which is what makes voice and mouse agree.
	{ specs: TODO_TOOLS, run: (name, args) => runTodoTool(todos, name, args) }
)

let newTodo = $state('')

function addTodo(event: SubmitEvent) {
	event.preventDefault()
	if (newTodo.trim() === '') return
	todos.create(newTodo)
	newTodo = ''
}

const listener = new Listener({
	// Barge-in. This fires on voice activity alone, ~64ms in, with nothing yet
	// transcribed — which is the only way interrupting feels like interrupting
	// a person rather than cancelling a download.
	onSpeechStart: () => {
		if (speaker.speaking || chat.streaming) {
			speaker.silence()
			chat.stop()
		}
	},
	// A finished utterance is just a message. No send button in the loop.
	onUtterance: (text) => {
		speaker.resumeAudio()
		chat.send(text)
	}
})

// Hands-free by default: the mic opens as soon as the page does. The permission
// prompt is the one gesture the browser insists on, and it appears on its own.
$effect(() => {
	void listener.start()
	return () => listener.stop()
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
	if (speaker.status === 'preparing')
		return { key: 'loading', label: `Stimme lädt ${Math.round(speaker.progress * 100)}%` }
	if (listener.status === 'preparing')
		return { key: 'loading', label: `Ohren laden ${Math.round(listener.progress * 100)}%` }
	if (listener.speech) return { key: 'hearing', label: 'Hört zu' }
	if (speaker.speaking) return { key: 'speaking', label: 'Spricht' }
	if (chat.streaming) return { key: 'thinking', label: 'Denkt nach' }
	if (listener.status === 'listening') return { key: 'idle', label: 'Bereit' }
	return { key: 'text', label: 'Nur Text' }
})

let draft = $state('')
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

<main class="mx-auto flex h-dvh max-w-6xl flex-col gap-4 p-4 sm:p-6">
	<header class="flex items-baseline justify-between gap-4">
		<h1 class="text-2xl">Dashboard</h1>
		<div class="flex items-center gap-3 text-xs opacity-50">
			<span>phala/gemma-4-31b-it</span>

			<!-- Whose turn it is, in one place. Not a switch: nothing here starts or
			     stops anything, it only says what the system is doing. -->
			<span
				class="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1"
				class:opacity-100={phase.key !== 'idle'}
				title="Silero VAD · Nemotron 3.5 (de-DE) · Supertonic-3 M5 — alles on-device"
			>
				<!-- While listening the dot follows the microphone level, so a dead
				     input is visible as a dot that never moves. -->
				<span
					class="inline-block size-1.5 rounded-full transition-transform"
					class:bg-status-error={phase.key === 'hearing' || phase.key === 'idle'}
					class:bg-status-success={phase.key === 'speaking'}
					class:bg-status-working={phase.key === 'thinking' || phase.key === 'loading'}
					class:bg-muted-foreground={phase.key === 'denied' || phase.key === 'text'}
					class:animate-pulse={phase.key === 'thinking' || phase.key === 'loading'}
					style={phase.key === 'hearing' || phase.key === 'idle'
						? `transform: scale(${1 + Math.min(listener.level, 1) * 2.5})`
						: ''}
				></span>
				{phase.label}
			</span>

			{#if chat.turns.length > 0}
				<button
					type="button"
					class="underline underline-offset-4"
					onclick={() => {
						chat.clear()
						speaker.silence()
						void listener.reset()
					}}
				>
					Clear
				</button>
			{/if}
			<a href="/" class="underline underline-offset-4">Back</a>
		</div>
	</header>

	<div class="flex min-h-0 flex-1 gap-6">
		<div bind:this={log} class="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto">
			{#if chat.turns.length === 0}
				<div class="pt-16 text-center">
					{#if listener.status === 'listening'}
						<p class="text-base">Sprich einfach los.</p>
						<p class="pt-2 text-xs opacity-40">
							Das Mikrofon ist offen. Du kannst mich jederzeit unterbrechen.
						</p>
					{:else if listener.status === 'preparing'}
						<p class="text-sm opacity-40">
							Die Ohren laden — {Math.round(listener.progress * 100)}% von etwa 2,6 GB.
						</p>
					{:else}
						<p class="text-sm opacity-40">Schreib etwas.</p>
					{/if}
				</div>
			{/if}

			{#each chat.turns as turn (turn.id)}
				<div class="flex flex-col gap-1" class:items-end={turn.role === 'user'}>
					<!-- What it actually did, not just what it says it did. -->
					{#if turn.tools && turn.tools.length > 0}
						<span class="text-[10px] uppercase tracking-widest opacity-30">
							{turn.tools.join(' · ')}
						</span>
					{/if}
					<div
						class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed"
						class:bg-primary={turn.role === 'user'}
						class:text-primary-foreground={turn.role === 'user'}
						class:bg-surface-card={turn.role === 'assistant'}
						class:border={turn.role === 'assistant'}
						class:border-border={turn.role === 'assistant'}
					>
						{turn.content ||
						(turn.role === 'assistant' && chat.streaming ? '…' : '')}
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

		<!-- The same list the model edits. Voice and mouse are the same operations
	     on the same store, so a spoken todo and a typed one are indistinguishable. -->
		<aside class="flex w-72 min-h-0 flex-col gap-3">
			<div class="flex items-baseline justify-between">
				<h2 class="text-sm">Aufgaben</h2>
				<span class="text-xs opacity-40">
					{todos.open.length}
					offen{todos.items.length > todos.open.length
					? ` · ${todos.items.length - todos.open.length} erledigt`
					: ''}
				</span>
			</div>

			<form onsubmit={addTodo}>
				<input
					bind:value={newTodo}
					placeholder="Aufgabe hinzufügen…"
					class="w-full rounded-full border border-border bg-input px-4 py-2 text-sm outline-none focus:border-primary-soft"
				>
			</form>

			<ul class="min-h-0 flex-1 space-y-1 overflow-y-auto">
				{#each todos.items as todo (todo.id)}
					<li
						class="group flex items-center gap-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-sm"
					>
						<input
							type="checkbox"
							checked={todo.done}
							onchange={() => todos.toggle(todo.id)}
							class="size-3.5 shrink-0 accent-primary"
						>
						<span
							class="flex-1 leading-snug"
							class:line-through={todo.done}
							class:opacity-40={todo.done}
						>
							{todo.title}
						</span>
						<button
							type="button"
							onclick={() => todos.remove(todo.id)}
							class="shrink-0 opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-100"
							aria-label="Löschen"
						>
							×
						</button>
					</li>
				{:else}
					<li class="pt-6 text-center text-xs opacity-40">
						Noch nichts. Sag zum Beispiel „setz Milch kaufen auf die Liste“.
					</li>
				{/each}
			</ul>
		</aside>
	</div>

	<form bind:this={form} onsubmit={submit} class="flex items-end gap-2">
		<textarea
			bind:value={draft}
			onkeydown={onKeydown}
			rows="1"
			placeholder="Message…"
			class="field-sizing-content max-h-40 flex-1 resize-none rounded-2xl border border-border bg-input px-4 py-3 text-sm outline-none focus:border-primary-soft"
		></textarea>

		{#if chat.streaming}
			<button
				type="button"
				onclick={() => {
					chat.stop()
					speaker.silence()
				}}
				class="rounded-full border border-border px-5 py-3 text-sm transition-colors hover:bg-surface-card-hover"
			>
				Stop
			</button>
		{:else}
			<button
				type="submit"
				disabled={draft.trim() === ''}
				class="rounded-full bg-primary px-5 py-3 text-sm text-primary-foreground transition-opacity disabled:opacity-30"
			>
				Send
			</button>
		{/if}
	</form>
</main>
