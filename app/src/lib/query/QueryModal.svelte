<script lang="ts">
import { ACTIVITY_LABELS, activity } from '$lib/actors/activity.svelte'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { listenerActor } from '$lib/actors/listener.actor.svelte'
import { query } from './query.svelte'

/**
 * THE conversation surface (0159) — one modal over the dimmed workspace,
 * holding what was said and what the system says back, with the composer as
 * its footer. It replaced a chat aside, a window pane, a transcription toast
 * and a standalone gate card, which were four places for one idea.
 *
 * The spotlight-style search band that used to sit above the conversation is
 * parked for now: the modal is the chat, and the chat only.
 *
 * The composer is ONE area with two faces. Typing: an editable field and a
 * send button. Voice: the same field shows what is being heard, and the send
 * slot wears an ear — the pause in your voice is the send. Same geometry,
 * same place, so switching modes never moves anything.
 *
 * The voice pill stays outside and beneath, and ABOVE the scrim — it is how
 * you speak, so it must never be behind the thing it is speaking to.
 */

let {
	typing,
	draft = $bindable(''),
	onEnterTyping,
	onSubmit
}: {
	typing: boolean
	draft?: string
	onEnterTyping: () => void
	onSubmit: () => void
} = $props()

const chat = chatActor.core
const listener = listenerActor.core

let form: HTMLFormElement | null = $state(null)
let textareaEl: HTMLTextAreaElement | null = $state(null)

// Switching to text mode should land the cursor in the field — no second click
// to start writing. Focusing an already-focused field is a harmless no-op.
$effect(() => {
	if (typing && textareaEl) textareaEl.focus()
})

/**
 * The conversation follows itself: a reply arriving below the fold is a reply
 * you did not read. It tracks the streamed content too, not just the turn
 * count, so a long answer keeps its own tail in view as it lands.
 */
let chatEl: HTMLElement | null = $state(null)
$effect(() => {
	void chat.turns.length
	void chat.turns.at(-1)?.content
	void activity.current
	chatEl?.scrollTo({ top: chatEl.scrollHeight })
})

/** Enter sends, shift+enter makes a newline — the usual bargain. */
function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault()
		form?.requestSubmit()
	}
}
</script>

{#if query.open}
	<!-- The scrim dims the workspace without removing it: the selected intent
	     stays visible behind, which is the whole reason the modal is aware of
	     it. Clicking the scrim closes. -->
	<button
		type="button"
		aria-label="Schließen"
		onclick={() => query.close()}
		class="fixed inset-0 z-30 cursor-default bg-marine/25 backdrop-blur-[2px]"
	></button>

	<!-- Sized by the conversation: never less than 30% of the screen, so the
	     composer and the first exchanges have room from the first word; never
	     more than what fits above the dock. -->
	<div
		class="-translate-x-1/2 absolute bottom-2 left-1/2 z-40 flex max-h-[min(82vh,calc(100dvh-var(--dock-h,0px)-1.5rem))] min-h-[30dvh] w-[min(72rem,94%)] max-w-none flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-surface-raised shadow-[0_12px_40px_rgba(30,41,59,0.22)]"
		style="margin-bottom: var(--dock-h, 0px)"
	>
		<!-- ── The conversation ── -->
		<div bind:this={chatEl} class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
			{#if chat.turns.length === 0 && !activity.current}
				<p class="m-auto px-2 py-6 text-center text-foreground/40 text-sm">
					{query.intent ? 'Frag etwas zu diesem Intent.' : 'Frag etwas — oder sag es einfach.'}
				</p>
			{/if}

			{#each chat.turns as turn (turn.id)}
				<div class="flex" class:justify-end={turn.role === 'user'}>
					<div
						class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed {turn.role ===
						'user'
							? 'bg-primary text-primary-foreground'
							: 'border border-border bg-surface-card'}"
					>
						{#if turn.content === '' && turn.role === 'assistant' && chat.streaming}
							<span class="flex items-center gap-1 py-1" aria-label="Denkt nach">
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

			<!-- What the tools just DID, inline. A tool result is part of the
			     conversation that asked for it; as a toast under the modal it read
			     as a notification about somewhere else. -->
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
							<!-- One per line: run together with separators, five items became
							     a sentence that ran off the edge and told you nothing. -->
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

		<!-- ── The composer: the modal's footer ── -->
		<form
			bind:this={form}
			onsubmit={(e) => {
				e.preventDefault()
				onSubmit()
			}}
			class="flex shrink-0 items-end gap-2 border-foreground/10 border-t bg-surface-soft p-2.5"
		>
			{#if typing}
				<textarea
					bind:this={textareaEl}
					bind:value={draft}
					onkeydown={onKeydown}
					rows="1"
					placeholder="Schreib…"
					class="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface-raised px-3.5 py-2.5 text-sm leading-snug outline-none placeholder:text-foreground/35 focus:border-foreground/25"
				></textarea>
				<button
					type="submit"
					disabled={draft.trim() === ''}
					title="Senden"
					aria-label="Senden"
					class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-30"
				>
					<!-- arrow up: send -->
					<svg
						viewBox="0 0 24 24"
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M12 19V5" />
						<path d="m5 12 7-7 7 7" />
					</svg>
				</button>
			{:else}
				<!-- The same field, read-only: what is being heard, as it is heard.
				     Tapping it is the way into typing. -->
				<button
					type="button"
					onclick={onEnterTyping}
					class="min-h-10 flex-1 rounded-2xl border border-border border-dashed bg-surface-raised px-3.5 py-2.5 text-left text-sm leading-snug transition-colors hover:border-foreground/25 {listener.partial ===
					''
						? 'text-foreground/35'
						: 'text-foreground/80'}"
				>
					{listener.partial === '' ? 'Sprich — oder tipp hier…' : listener.partial}
				</button>
				<!-- The send slot, worn by the ear: a pause in your voice sends.
				     Same circle as the send button, so the area never changes shape. -->
				<span
					title="Sendet von selbst, wenn du pausierst"
					aria-label="Sendet von selbst, wenn du pausierst"
					class="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground/50 {listener.partial !==
					''
						? 'border-error/60 text-error'
						: ''}"
				>
					<!-- lucide:ear -->
					<svg
						viewBox="0 0 24 24"
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0" />
						<path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4" />
					</svg>
				</span>
			{/if}
		</form>
	</div>
{/if}
