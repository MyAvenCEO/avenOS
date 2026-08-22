<script lang="ts">
import AvenUiView from '$lib/actors/AvenUiView.svelte'
import { ACTIVITY_LABELS, activity } from '$lib/actors/activity.svelte'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { listenerActor } from '$lib/actors/listener.actor.svelte'
import { registryTick } from '$lib/actors/reactivity.svelte'
import { isWindow } from '$lib/actors/window.actor.svelte'
import { query } from './query.svelte'

/**
 * THE conversation surface (0159) — one modal over the dimmed workspace,
 * holding what was said, what the system says back, and the views it puts
 * on screen, with the composer as its footer. It replaced a chat aside, a
 * window pane, a transcription toast and a standalone gate card, which were
 * four places for one idea.
 *
 * One conversation, not two modes: the composer is always there, and the
 * ears are open whenever the conversation is live. Write, speak, or both —
 * what is heard is written INTO the field as it is heard; a typed line goes
 * on Enter, a spoken one on the pause after it. The send slot says which:
 * the arrow while there is a typed draft, the ear while it listens or while
 * words are still arriving.
 *
 * Views are window actors (0130): the model opens one by message ("zeig mir
 * das Board") and it renders here, above the messages, until it is closed.
 *
 * The voice pill stays outside and beneath, and ABOVE the scrim — it is how
 * you speak, so it must never be behind the thing it is speaking to.
 */

let {
	draft = $bindable(''),
	listening,
	onSubmit
}: {
	draft?: string
	/** Ears open: a pause sends. Drives the ear in the send slot. */
	listening: boolean
	onSubmit: () => void
} = $props()

const chat = chatActor.core
const listener = listenerActor.core

/** Every window the model has opened, in registry order. */
const windows = $derived(
	registryTick.v >= 0
		? bus
				.actors()
				.filter(isWindow)
				.filter((w) => w.open)
		: []
)

let form: HTMLFormElement | null = $state(null)
let textareaEl: HTMLTextAreaElement | null = $state(null)

// Opening the conversation lands the cursor in the field — no second click
// to start writing. Focusing an already-focused field is a harmless no-op.
$effect(() => {
	if (query.open && textareaEl) textareaEl.focus()
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
	void listener.partial
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

const empty = $derived(draft.trim() === '')
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
		<!-- ── The views the model put on screen ── -->
		{#each windows as win (win.manifest.id)}
			<!-- A view gets the lion's share: AvenUiView's host is `flex-1`, but
			     it can only grow inside a flex column that HAS a height — without
			     min-h-0 + flex-1 here the board collapsed to its content. -->
			<div
				class="m-3 mb-0 flex min-h-0 flex-1 basis-[55%] flex-col overflow-hidden rounded-xl border border-foreground/10 bg-surface-soft"
			>
				<div
					class="flex shrink-0 items-center border-foreground/5 border-b px-3 py-1.5 font-mono text-[0.5625rem] text-foreground/40 uppercase tracking-wide"
				>
					<span class="flex-1">{win.manifest.name}</span>
					<button
						type="button"
						onclick={() => {
							win.open = false
						}}
						title="Ausblenden"
						aria-label="{win.manifest.name} ausblenden"
						class="-mr-1 rounded-full p-1 transition-colors hover:bg-surface-card-selected"
					>
						<svg
							viewBox="0 0 24 24"
							class="size-3"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						>
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
					</button>
				</div>
				<AvenUiView actor={win.subject} {...win.props} />
			</div>
		{/each}

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
			<textarea
				bind:this={textareaEl}
				bind:value={draft}
				onkeydown={onKeydown}
				rows="1"
				placeholder={listening ? 'Sprich — oder schreib…' : 'Schreib…'}
				class="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface-raised px-3.5 py-2.5 text-sm leading-snug outline-none placeholder:text-foreground/35 focus:border-foreground/25"
			></textarea>
			<!-- The send slot. With a typed draft it is the send button; while
			     listening to an empty field, or while words are still arriving,
			     it wears the ear — the pause sends. One circle either way, so the
			     area never changes shape. -->
			{#if listening && (empty || listener.partial !== '')}
				<span
					title="Sendet von selbst, wenn du pausierst"
					aria-label="Sendet von selbst, wenn du pausierst"
					class="flex size-10 shrink-0 items-center justify-center rounded-full border bg-surface-raised transition-colors {listener.partial !==
					''
						? 'border-error/60 text-error'
						: 'border-border text-foreground/50'}"
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
			{:else}
				<button
					type="submit"
					disabled={empty}
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
			{/if}
		</form>
	</div>
{/if}
