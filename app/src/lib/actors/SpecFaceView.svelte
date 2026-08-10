<script lang="ts">
import type { Actor } from './actor'
import { functor } from './actor'
import { bus } from './bus'
import type { RecordActor } from './created.actor.svelte'

/**
 * The universal face renderer: one component that interprets a manifest's
 * declared `face` spec. The composer designs the spec the same way it
 * designs contracts; this file turns it into a working mini app — inputs
 * that run goals through the engine, the actor's remembered records as
 * cards, action buttons that send ordinary messages. No generated code,
 * no eval: the face is data, the renderer is the only program.
 */
const { actor }: { actor: Actor } = $props()

const spec = $derived(actor.manifest.face ?? { elements: [] })
const keeper = $derived(actor as RecordActor)
const instance = $derived(actor.instanceState())

let inputs = $state<Record<number, string>>({})
let results = $state<Record<number, string>>({})
let busy = $state<number | null>(null)

async function run(index: number, goal: string) {
	if (busy !== null) return
	busy = index
	results[index] = ''
	try {
		const text = (inputs[index] ?? '').trim()
		// The typed text grounds EVERY requirement — the actor's model sees it
		// under each functor and reads out what it needs.
		const facts =
			text !== '' ? Object.fromEntries(actor.requires.map((r) => [functor(r), { text }])) : {}
		const outcome = await bus.satisfy(goal, facts)
		const last = outcome.steps.at(-1)
		results[index] =
			outcome.status === 'ok'
				? `✓ ${JSON.stringify(last?.out ?? {})}`
				: `✗ failed: ${JSON.stringify(last?.out ?? {})}`
		if (outcome.status === 'ok') inputs[index] = ''
	} finally {
		busy = null
	}
}

async function act(index: number, method: string, payload: Record<string, unknown> = {}) {
	if (busy !== null) return
	busy = index
	try {
		const result = await bus.dispatch(`${actor.manifest.id}-face`, method, payload)
		results[index] = result.wire
	} finally {
		busy = null
	}
}

/** A record's data as displayable [key, value] rows; primitives get one row. */
function rows(data: unknown): [string, string][] {
	// Models often wrap the payload once more ({"appointment": {...}}) —
	// unwrap single-key envelopes so the card shows fields, not JSON.
	let inner = data
	while (
		inner &&
		typeof inner === 'object' &&
		Object.keys(inner).length === 1 &&
		typeof Object.values(inner)[0] === 'object' &&
		Object.values(inner)[0] !== null
	) {
		inner = Object.values(inner)[0]
	}
	if (inner && typeof inner === 'object') {
		return Object.entries(inner as Record<string, unknown>).map(([k, v]) => [
			k,
			typeof v === 'object' ? JSON.stringify(v) : String(v)
		])
	}
	return [['value', String(inner)]]
}
</script>

<div class="flex flex-col gap-3 text-foreground">
	{#each spec.elements as element, i (`e${i}`)}
		{#if element.kind === 'note'}
			<p class="text-foreground/50 text-sm leading-relaxed">{element.text}</p>
		{:else if element.kind === 'state'}
			{#if instance}
				<dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
					{#each Object.entries(instance) as [key, value] (key)}
						<div>
							<dt class="text-[0.6875rem] text-foreground/40">{key}</dt>
							<dd class="font-medium">{value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		{:else if element.kind === 'run'}
			<form
				onsubmit={(event) => {
					event.preventDefault()
					void run(i, element.goal)
				}}
				class="flex items-center gap-2"
			>
				<input
					bind:value={inputs[i]}
					placeholder={element.placeholder ?? `Input for ${element.goal}…`}
					class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-surface-soft/60 px-4 py-2 text-sm outline-none placeholder:text-foreground/30"
				>
				<button
					type="submit"
					disabled={busy !== null}
					class="shrink-0 rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
				>
					{busy === i ? 'running…' : (element.label ?? 'Run')}
				</button>
			</form>
			{#if results[i]}
				<p class="break-all font-mono text-[0.6875rem] leading-relaxed text-foreground/60">
					{results[i]}
				</p>
			{/if}
		{:else if element.kind === 'action'}
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => void act(i, element.method, element.payload ?? {})}
					disabled={busy !== null}
					class="rounded-full border border-foreground/10 px-4 py-2 text-sm transition-opacity disabled:opacity-30"
				>
					{element.label}
				</button>
				{#if results[i]}
					<span class="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground/50">
						{results[i]}
					</span>
				{/if}
			</div>
		{:else if element.kind === 'records'}
			<div class="flex flex-col gap-2">
				{#if element.title}
					<h3 class="font-semibold text-[13px] text-foreground/60">{element.title}</h3>
				{/if}
				{#if !keeper.records || keeper.records.length === 0}
					<p class="text-[13px] text-foreground/30">Nothing here yet — run the actor above.</p>
				{:else}
					<ul class="space-y-2">
						{#each keeper.records as record (record.id)}
							<li
								class="group flex items-start gap-3 rounded-2xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.06)]"
							>
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									{#each rows(record.data) as [key, value] (key)}
										<div class="flex items-baseline gap-2">
											<span class="shrink-0 font-mono text-[0.625rem] text-foreground/35">
												{key}
											</span>
											<span class="min-w-0 flex-1 break-words font-medium leading-snug">
												{value}
											</span>
										</div>
									{/each}
								</div>
								<button
									type="button"
									onclick={() => keeper.forget(record.id)}
									class="shrink-0 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
									aria-label="Delete"
								>
									×
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/each}
</div>
