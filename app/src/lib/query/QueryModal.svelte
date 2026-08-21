<script lang="ts">
import AvenUiView from '$lib/actors/AvenUiView.svelte'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { listenerActor } from '$lib/actors/listener.actor.svelte'
import { registryTick } from '$lib/actors/reactivity.svelte'
import { isWindow } from '$lib/actors/window.actor.svelte'
import { runQuery } from './answer'
import { query } from './query.svelte'

/**
 * THE answer surface (0159) — one modal over the dimmed workspace, holding
 * everything the system says back: search hits, whole actor views, prose, and
 * human gates. It replaced a chat aside, a window pane, a transcription toast
 * and a standalone gate card, which were four places for one idea.
 *
 * Two bands, top to bottom (never side by side): answers above, conversation
 * below. The voice pill stays outside and beneath, and ABOVE the scrim — it is
 * how you speak, so it must never be behind the thing it is speaking to.
 */

const chat = chatActor.core
const listener = listenerActor.core

/** What was asked for. Human gates are NOT here — they keep their own place
 * above the voice pill, where they cannot be dismissed by closing a search. */
const answers = $derived(runQuery(query.text, { intent: query.intent }))

/** How a row draws itself. A map, not a branch: adding a shape is adding a key,
 * and the engine that produced the row never learns what any of them mean. */
const SHAPE: Record<string, { glyph: string; tone: string }> = {
	check: { glyph: '☐', tone: 'text-progress-ink' },
	person: { glyph: '◍', tone: 'text-quiet-ink' },
	time: { glyph: '◷', tone: 'text-info-ink' },
	doc: { glyph: '▤', tone: 'text-foreground/45' },
	note: { glyph: '❖', tone: 'text-success-ink' }
}
const FALLBACK = { glyph: '·', tone: 'text-foreground/40' }

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
	chatEl?.scrollTo({ top: chatEl.scrollHeight })
})

/** Resolve a view answer to its window actor, if that window still exists. */
function windowFor(key: string) {
	return bus
		.actors()
		.filter(isWindow)
		.find((w) => w.manifest.id === `${key}-window`)
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

	<!-- It takes every pixel above the dock, capped so it never becomes the whole
	     screen: a fixed 82vh plus the dock clearance overflowed off the top. -->
	<div
		class="-translate-x-1/2 absolute bottom-2 left-1/2 z-40 flex h-[calc(100dvh-var(--dock-h,0px)-1.5rem)] max-h-[82vh] w-[min(72rem,94%)] max-w-none flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-surface-raised shadow-[0_12px_40px_rgba(30,41,59,0.22)]"
		style="margin-bottom: var(--dock-h, 0px)"
	>
		<!-- ── Band 1: the answers ── -->
		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
			{#if answers.length === 0}
				<p class="px-2 py-8 text-center text-foreground/40 text-sm">
					{query.intent
						? 'Frag etwas zu diesem Intent — oder such alles.'
						: 'Frag etwas, such etwas, oder sag „zeig mir das Board".'}
				</p>
			{/if}

			{#each answers as answer (answer.kind + answer.id)}
				{#if answer.kind === 'rows'}
					<div>
						<p
							class="px-2 pb-1 font-mono text-[0.5625rem] text-foreground/35 uppercase tracking-wide"
						>
							{answer.source}
						</p>
						<ul class="flex flex-col">
							{#each answer.rows as row (row.id)}
								{@const shape = SHAPE[row.shape] ?? FALLBACK}
								<li
									class="flex items-baseline gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-soft"
								>
									<span class="w-3 shrink-0 text-center {shape.tone}">{shape.glyph}</span>
									<span class="min-w-0 flex-1 truncate text-sm">{row.label}</span>
									{#if row.note}
										<span class="shrink-0 text-[0.6875rem] text-foreground/40">{row.note}</span>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{:else if answer.kind === 'view'}
					{@const win = registryTick.v >= 0 ? windowFor(answer.window) : undefined}
					{#if win}
						<div class="overflow-hidden rounded-xl border border-foreground/10 bg-surface-soft">
							<p
								class="border-foreground/5 border-b px-3 py-1.5 font-mono text-[0.5625rem] text-foreground/40 uppercase tracking-wide"
							>
								{answer.title}
							</p>
							<AvenUiView actor={win.subject} {...win.props} />
						</div>
					{/if}
				{:else if answer.kind === 'say'}
					<div class="flex" class:justify-end={answer.role === 'user'}>
						<div
							class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed {answer.role ===
							'user'
								? 'bg-primary text-primary-foreground'
								: 'border border-border bg-surface-card'}"
						>
							{answer.text}
						</div>
					</div>
				{/if}
			{/each}
		</div>

		<!-- ── Band 2: the conversation, under the answers ── -->
		{#if chat.turns.length > 0 || listener.partial !== ''}
			<div
				bind:this={chatEl}
				class="max-h-[38%] shrink-0 overflow-y-auto border-foreground/10 border-t bg-surface-soft px-3 py-2.5"
			>
				<div class="flex flex-col gap-1.5">
					{#each chat.turns as turn (turn.id)}
						<div class="flex" class:justify-end={turn.role === 'user'}>
							<div
								class="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed {turn.role ===
								'user'
									? 'bg-primary text-primary-foreground'
									: 'border border-border bg-surface-raised'}"
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

					<!-- What is being heard, as it is being heard. It belongs with the
					     conversation, not floating over the workspace as it used to. -->
					{#if listener.partial !== ''}
						<div class="flex justify-end">
							<div
								class="max-w-[85%] rounded-2xl border border-border border-dashed bg-surface-card px-3 py-1.5 text-[13px] opacity-70"
							>
								{listener.partial}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
