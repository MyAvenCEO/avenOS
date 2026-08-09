<script lang="ts">
import { Listener } from '$lib/asr/listener.svelte'
import { Chat } from '$lib/chat/chat.svelte'
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
const chat = new Chat({
	onDelta: (text) => speaker.feed(text),
	onDone: () => speaker.flush()
})

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

<main class="mx-auto flex h-dvh max-w-3xl flex-col gap-4 p-4 sm:p-6">
	<header class="flex items-baseline justify-between gap-4">
		<h1 class="text-2xl">Dashboard</h1>
		<div class="flex items-center gap-3 text-xs opacity-50">
			<span>phala/gemma-4-31b-it</span>

			<!-- Passive status, not switches: both ears and voice are simply on.
			     The dot is the important part — "ready" in words is easy to read as
			     "ready to be started", which is exactly the wrong idea. -->
			{#if listener.status !== 'unavailable'}
				<span
					class="flex items-center gap-1.5"
					title="Nemotron 3.5 · Silero VAD · deutsch, on-device"
				>
					{#if listener.status === 'preparing'}
						Ohren laden… {Math.round(listener.progress * 100)}%
					{:else if listener.status === 'denied'}
						Kein Mikrofon — bitte in den Systemeinstellungen erlauben
					{:else if listener.status === 'error'}
						Ohren fehlgeschlagen
					{:else}
						<span
							class="inline-block size-1.5 rounded-full bg-status-error"
							class:animate-pulse={listener.speech}
						></span>
						{listener.speech ? 'Hört zu…' : 'Mikrofon an'}
					{/if}
				</span>
			{/if}

			{#if speaker.status !== 'unavailable'}
				<span title="Supertonic-3 · Stimme M5 · deutsch, on-device (Rust/ONNX)">
					{#if speaker.status === 'preparing'}
						Stimme lädt… {Math.round(speaker.progress * 100)}%
					{:else if speaker.status === 'error'}
						Stimme fehlgeschlagen
					{:else}
						{speaker.speaking ? 'Spricht' : 'Stimme bereit'}
					{/if}
				</span>
			{/if}

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

	<div bind:this={log} class="flex-1 space-y-4 overflow-y-auto">
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
			<div class="flex" class:justify-end={turn.role === 'user'}>
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
