<script lang="ts">
import FaceHost from './FaceHost.svelte'
import { faces } from './faces'
import {
	type Actor,
	actorState,
	faceState,
	find,
	type Message,
	memberState,
	needs,
	path,
	YOU
} from './model'

/**
 * ONE card per engaged coordinator — everything on it is derived from
 * the thread: the state pill, the member dots, the path (the chain of
 * open asks down to the working leaf, `you` included when the stack
 * ends at the human), the open needs, and the face facts.
 */
const { actors, id, log }: { actors: Actor[]; id: string; log: Message[] } = $props()

const actor = $derived(find(actors, id))
const state = $derived(actorState(actors, id, log))
const stack = $derived(path(actors, id, log))
const open = $derived(needs(actors, id, log))
const face = $derived(faces[id])
const facts = $derived(faceState(actors, id, log))

const label = (aid: string) => (aid === YOU ? 'you' : (find(actors, aid)?.manifest.name ?? aid))

const PILL: Record<string, { label: string; klasse: string }> = {
	working: { label: 'working', klasse: 'text-status-working' },
	'needs-you': { label: 'needs you', klasse: 'text-primary' },
	waiting: { label: 'waiting', klasse: 'text-foreground/40' },
	done: { label: 'done', klasse: 'text-status-success' }
}
const MARK: Record<string, { mark: string; klasse: string }> = {
	done: { mark: '●', klasse: 'text-status-success' },
	current: { mark: '◐', klasse: 'text-primary' },
	pending: { mark: '○', klasse: 'text-foreground/25' }
}
</script>

<article
	class="flex flex-col gap-3 rounded-2xl border p-4 {state === 'needs-you'
		? 'border-primary/40 bg-surface-cream/40'
		: state === 'waiting'
			? 'border-border border-dashed bg-surface-card/40'
			: 'border-border bg-surface-card'}"
>
	<header class="flex flex-wrap items-baseline gap-2">
		<h4 class="font-semibold text-sm">{actor?.manifest.name}</h4>
		<span class="text-foreground/45 text-xs">{actor?.manifest.about}</span>
		<span class="ml-auto font-mono text-[0.625rem] {PILL[state].klasse}">{PILL[state].label}</span>
	</header>

	<!-- Member dots + the ask-stack breadcrumb: depth as a path, never boxes. -->
	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-1.5">
			{#each actor?.members ?? [] as m (m)}
				{@const ms = memberState(m, log)}
				<span class="font-mono text-[0.5625rem] {MARK[ms].klasse}" title={label(m)}>
					{MARK[ms].mark}
				</span>
				{#if ms === 'current'}
					<span class="pr-1 font-medium text-foreground text-xs">{label(m)}</span>
				{/if}
			{/each}
		</div>
		{#if stack.length > 1}
			<p class="font-mono text-[0.625rem] text-foreground/45">
				└ {stack.slice(1, -1).map(label).join(' ▸ ')}{stack.length > 2 ? ' ▸ ' : ''}
				<span class="font-medium text-primary">◐ {label(stack.at(-1) ?? '')}</span>
			</p>
		{/if}
	</div>

	{#if state === 'waiting' && open.length}
		<p class="font-mono text-[0.625rem] text-status-working">
			◇ needs {open.join(', ')} — resumes on its own once delivered.
		</p>
	{/if}

	{#if face}
		<div class="border-border/60 border-t pt-3">
			<FaceHost {face} {facts} />
		</div>
	{/if}

	{#if state === 'needs-you'}
		<p class="text-[0.625rem] text-foreground/40">
			Your answer flows back as a message into this thread — mock: no wiring yet.
		</p>
	{/if}
</article>
