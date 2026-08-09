<script lang="ts">
import { Chat } from '$lib/chat/chat.svelte'
import { Speaker } from '$lib/tts/speaker.svelte'

/**
 * Dashboard — a chat against RedPill's confidential Gemma
 * (`phala/gemma-4-31b-it`), streamed token by token, spoken aloud in German by
 * Moonshine as it arrives.
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

			<!-- Passive status, not a switch: the voice is on wherever it can be. -->
			{#if speaker.status !== 'unavailable'}
				<span title="Supertonic-3 · Stimme M1 · deutsch, on-device (Rust/ONNX)">
					{#if speaker.status === 'preparing'}
						Stimme lädt…
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
			<p class="pt-16 text-center text-sm opacity-40">
				Confidential inference in a TEE. Say something.
			</p>
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

		{#if chat.failure || speaker.failure}
			<p
				class="rounded-2xl border border-status-error/30 bg-status-error-muted px-4 py-3 text-sm text-status-error-strong"
			>
				{chat.failure ?? speaker.failure}
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
