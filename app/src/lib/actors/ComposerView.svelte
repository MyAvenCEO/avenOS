<script lang="ts">
import { functor } from './actor'
import { bus } from './bus'
import type { ComposerActor, ComposerStage } from './composer.actor.svelte'

/**
 * The composer's face: the actor-creation flow made visible. A stage rail
 * shows where the pipeline stands (wish → draft → register → live), the step
 * log narrates what the model is doing under the hood, and the draft renders
 * as the actual manifest it is — contract pills, lane, tags — with commit,
 * revise and discard as buttons that send the same messages the voice does.
 */
const { actor }: { actor: ComposerActor } = $props()

const STAGES: { key: ComposerStage[]; label: string }[] = [
	{ key: ['drafting'], label: 'Draft' },
	{ key: ['draft'], label: 'Review' },
	{ key: ['registering'], label: 'Register' },
	{ key: ['live'], label: 'Live' }
]

const stageIndex = $derived(
	actor.stage === 'idle' ? -1 : STAGES.findIndex((s) => s.key.includes(actor.stage))
)

const PALETTE = [
	'bg-[#d4a373]/20 text-[#8a6238]',
	'bg-[#7e6ead]/15 text-[#655687]',
	'bg-[#2f5d50]/12 text-[#2f5d50]',
	'bg-[#5b7a9d]/15 text-[#46617f]',
	'bg-[#c15b40]/12 text-[#9c4832]',
	'bg-[#a06818]/12 text-[#a06818]'
]

function hue(p: string): string {
	const name = functor(p)
	let h = 0
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
	return PALETTE[h % PALETTE.length]
}

let wishDraft = $state('')
let revision = $state('')
let busy = $state(false)

async function send(method: string, payload: Record<string, unknown> = {}) {
	if (busy) return
	busy = true
	try {
		await bus.dispatch('composer-window', method, payload)
	} finally {
		busy = false
	}
}

function startDraft(event: SubmitEvent) {
	event.preventDefault()
	if (wishDraft.trim() === '') return
	const wish = wishDraft
	wishDraft = ''
	void send('composer_draft', { wish })
}

function revise(event: SubmitEvent) {
	event.preventDefault()
	if (revision.trim() === '') return
	const instruction = revision
	revision = ''
	void send('composer_revise', { instruction })
}
</script>

<div class="flex flex-col gap-4 text-foreground">
	<!-- The stage rail: where the flow stands, always visible. -->
	<div class="flex items-center gap-1.5 text-xs">
		{#each STAGES as s, i (s.label)}
			{#if i > 0}
				<span class="h-px w-4 {i <= stageIndex ? 'bg-primary/50' : 'bg-foreground/15'}"></span>
			{/if}
			<span
				class="flex items-center gap-1.5 rounded-full px-2.5 py-1 {i === stageIndex &&
				actor.stage !== 'live'
					? 'bg-primary text-primary-foreground'
					: i <= stageIndex
						? 'bg-primary/10 text-primary'
						: 'bg-foreground/5 text-foreground/40'}"
			>
				{#if i === stageIndex && (actor.stage === 'drafting' || actor.stage === 'registering')}
					<span class="size-1.5 animate-pulse rounded-full bg-current"></span>
				{/if}
				{s.label}
			</span>
		{/each}
		{#if actor.stage === 'failed'}
			<span class="rounded-full bg-status-error/10 px-2.5 py-1 text-status-error">failed</span>
		{/if}
	</div>

	{#if actor.stage === 'idle'}
		<p class="text-foreground/50 text-sm leading-relaxed">
			Describe an actor and I design it: contracts, lane, window — reviewed here before anything is
			registered. By voice ("create an actor that…") or right below.
		</p>
		<form onsubmit={startDraft} class="flex items-center gap-2">
			<input
				bind:value={wishDraft}
				placeholder="What should the new actor do?"
				class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
			>
			<button
				type="submit"
				disabled={wishDraft.trim() === '' || busy}
				class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
			>
				Draft
			</button>
		</form>
	{:else}
		{#if actor.wish}
			<p class="text-foreground/60 text-sm leading-relaxed">
				<span class="text-foreground/35">Wish:</span>
				“{actor.wish}”
			</p>
		{/if}

		<!-- The step log: what is happening under the hood, narrated live. -->
		<div class="flex flex-col gap-1 font-mono text-[0.6875rem]">
			{#each actor.steps as step, i (`${step.at}${i}`)}
				<div class="flex items-start gap-2">
					<span class={step.ok ? 'text-status-success' : 'text-status-error'}>
						{step.ok ? '✓' : '✗'}
					</span>
					<span class="min-w-0 flex-1 text-foreground/60">{step.label}</span>
				</div>
			{/each}
			{#if actor.stage === 'drafting' || actor.stage === 'registering'}
				<div class="flex items-center gap-2 text-foreground/40">
					<span class="size-1.5 animate-pulse rounded-full bg-current"></span>
					{#if actor.writing > 0}
						writing the manifest… {actor.writing} characters
					{:else if actor.thinking}
						thinking…
					{:else}
						working…
					{/if}
				</div>
			{/if}
		</div>

		{#if actor.stage === 'drafting' && actor.thinking}
			<!-- The model's actual deliberation, streamed live — the tail of its
			     chain of thought instead of a spinner. -->
			<div
				class="max-h-40 overflow-hidden rounded-xl border border-foreground/5 bg-foreground/[0.03] px-3 py-2"
			>
				<p class="text-[0.6875rem] text-foreground/35 uppercase tracking-wide">
					kimi-k3 is reasoning
				</p>
				<p
					class="pt-1 font-mono text-[0.6875rem] text-foreground/45 leading-relaxed [overflow-wrap:anywhere]"
				>
					…{actor.thinking.slice(-700)}
				</p>
			</div>
		{/if}

		{#if actor.draft}
			<!-- The draft, rendered as the manifest it is. -->
			<div
				class="flex flex-col gap-2.5 rounded-2xl border border-foreground/5 bg-[#fffdf7] p-4 shadow-[0_1px_3px_rgba(30,41,59,0.06)]"
			>
				<div class="flex flex-wrap items-baseline gap-2">
					<span class="font-semibold text-[15px]">{actor.draft.name}</span>
					<span class="font-mono text-[0.6875rem] text-foreground/35">{actor.draft.id}</span>
					{#each actor.draft.tags ?? [] as tag, i (`t${i}`)}
						<span
							class="rounded-full bg-foreground/5 px-2 py-0.5 text-[0.625rem] text-foreground/50"
						>
							{tag}
						</span>
					{/each}
				</div>
				<p class="text-foreground/60 text-sm leading-relaxed">{actor.draft.description}</p>
				<div class="flex flex-wrap items-center gap-1.5 text-xs">
					<span class="text-foreground/40">Contract:</span>
					{#each actor.draft.requires ?? [] as r, i (`r${i}`)}
						<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(r)}">{r}</span>
					{/each}
					<span class="text-foreground/30">→</span>
					{#each actor.draft.produces ?? [] as pr, i (`p${i}`)}
						<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(pr)}">{pr}</span>
					{/each}
				</div>
				{#if actor.draft.llm}
					<p class="font-mono text-[0.6875rem] text-foreground/40">
						lane:
						{typeof actor.draft.llm === 'object'
							? `${actor.draft.llm.model ?? 'default'}${actor.draft.llm.temperature !== undefined ? ` · temp ${actor.draft.llm.temperature}` : ''}`
							: 'default model'}
					</p>
				{/if}
			</div>
		{/if}

		{#if actor.stage === 'draft'}
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => void send('composer_commit')}
					disabled={busy}
					class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
				>
					Commit — make it real
				</button>
				<button
					type="button"
					onclick={() => void send('composer_discard')}
					disabled={busy}
					class="rounded-full border border-foreground/10 px-4 py-2 text-foreground/60 text-sm transition-colors hover:text-foreground"
				>
					Discard
				</button>
			</div>
			<form onsubmit={revise} class="flex items-center gap-2">
				<input
					bind:value={revision}
					placeholder="Change something about the draft…"
					class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
				>
				<button
					type="submit"
					disabled={revision.trim() === '' || busy}
					class="rounded-full border border-foreground/10 px-4 py-2 text-sm transition-opacity disabled:opacity-30"
				>
					Revise
				</button>
			</form>
		{/if}

		{#if actor.stage === 'live' || actor.stage === 'failed'}
			<button
				type="button"
				onclick={() => void send('composer_discard')}
				class="self-start rounded-full border border-foreground/10 px-4 py-2 text-foreground/60 text-sm transition-colors hover:text-foreground"
			>
				New actor
			</button>
		{/if}
	{/if}

	{#if actor.designFailures.length > 0}
		<!-- The failure trace: what went wrong across sessions. Retries quote
		     the newest entry back to the model — this is the self-healing loop
		     made visible. -->
		<details class="pt-1">
			<summary class="cursor-pointer text-[0.6875rem] text-foreground/40 hover:text-foreground/70">
				{actor.designFailures.length}
				failed design attempts on record
			</summary>
			<div class="flex flex-col gap-1.5 pt-2 font-mono text-[0.6875rem]">
				{#each [...actor.designFailures].reverse().slice(0, 8) as failure (`${failure.at}`)}
					<div class="rounded-lg bg-foreground/[0.03] px-2.5 py-1.5">
						<p class="text-foreground/50">
							{new Date(failure.at).toLocaleString()}
							· {failure.lane} · {failure.reason}
						</p>
						<p class="break-all pt-0.5 text-foreground/35">{failure.sample.slice(0, 160)}…</p>
					</div>
				{/each}
			</div>
		</details>
	{/if}
</div>
