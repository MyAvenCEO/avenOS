<script lang="ts">
import type { Actor } from './actor'
import { functor } from './actor'
import { bus } from './bus'
import type { RecordActor } from './created.actor.svelte'

/**
 * The universal face renderer: one component that interprets a manifest's
 * declared `face` spec. The catalog declares the spec next to the
 * contracts; this file turns it into a working mini app — inputs
 * that run goals through the engine, the actor's remembered records as
 * cards, action buttons that send ordinary messages. No generated code,
 * no eval: the face is data, the renderer is the only program.
 */
/** A named face passes its own spec; the default window falls back to manifest.face. */
const { actor, spec: specOverride }: { actor: Actor; spec?: import('./actor').FaceSpec } = $props()

const spec = $derived(specOverride ?? actor.manifest.face ?? { elements: [] })
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

/** Unwrap single-key envelopes ({"appointment": {...}}) down to the fields. */
function flat(data: unknown): Record<string, unknown> {
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
	return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : { value: inner }
}

/** Case-insensitive field lookup with alias fallbacks. */
function pick(data: Record<string, unknown>, ...names: (string | undefined)[]): unknown {
	for (const name of names) {
		if (!name) continue
		const key = Object.keys(data).find((k) => k.toLowerCase() === name.toLowerCase())
		if (key !== undefined && data[key] !== undefined && data[key] !== null && data[key] !== '') {
			return data[key]
		}
	}
	return undefined
}

const show = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v))

/**
 * One record as a designed card. The declared item mapping wins; without one,
 * common field names fill the slots — which is what turns yesterday's faces
 * into proper cards without a migration.
 */
interface CardModel {
	title?: string
	subtitle?: string
	badges: { text: string; done: boolean }[]
	progress?: number
	meta: string[]
	rest: [string, string][]
}

function card(data: unknown, item?: import('./actor').RecordItemSpec): CardModel {
	const d = flat(data)
	const used = new Set<string>()
	const take = (...names: (string | undefined)[]) => {
		for (const name of names) {
			if (!name) continue
			const key = Object.keys(d).find((k) => k.toLowerCase() === name.toLowerCase())
			if (key && d[key] !== undefined && d[key] !== null && d[key] !== '') {
				used.add(key)
				return d[key]
			}
		}
		return undefined
	}

	const title = take(item?.title, 'title', 'name', 'habit', 'what', 'text', 'entry', 'value')
	const subtitle = take(item?.subtitle, 'description', 'note', 'details', 'summary')
	const badges: { text: string; done: boolean }[] = []
	for (const field of item?.badges ?? ['status', 'streak']) {
		const v = take(field)
		if (v !== undefined) {
			const text = field.toLowerCase() === 'streak' ? `streak ${show(v)}` : show(v)
			badges.push({ text, done: /done|completed|erledigt|success/i.test(show(v)) })
		}
	}
	const rawProgress = take(item?.progress, 'progress')
	let progress: number | undefined
	if (typeof rawProgress === 'number') {
		progress = rawProgress <= 1 ? rawProgress * 100 : Math.min(rawProgress, 100)
	}
	const meta: string[] = []
	for (const field of item?.meta ?? ['when', 'date', 'time', 'reminder', 'day']) {
		const v = take(field)
		if (v !== undefined) meta.push(show(v))
	}
	// Whatever the mapping did not claim still shows, quietly — data never
	// disappears just because the designer forgot a field.
	const rest = Object.entries(d)
		.filter(([k]) => !used.has(k) && k.toLowerCase() !== 'id')
		.map(([k, v]) => [k, show(v)] as [string, string])
	return {
		title: title ? show(title) : undefined,
		subtitle: subtitle ? show(subtitle) : undefined,
		badges,
		progress,
		meta,
		rest
	}
}

/** One aggregate tile's value over the record list. */
function stat(
	records: { data: unknown }[],
	item: { field?: string; aggregate?: 'count' | 'latest' | 'sum' | 'max' }
): string {
	const aggregate = item.aggregate ?? (item.field ? 'latest' : 'count')
	if (aggregate === 'count') return String(records.length)
	const values = records.map((r) => pick(flat(r.data), item.field)).filter((v) => v !== undefined)
	if (values.length === 0) return '—'
	if (aggregate === 'latest') return show(values.at(-1))
	const numbers = values.map(Number).filter((n) => !Number.isNaN(n))
	if (numbers.length === 0) return '—'
	return String(aggregate === 'sum' ? numbers.reduce((a, b) => a + b, 0) : Math.max(...numbers))
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
		{:else if element.kind === 'stats'}
			<div class="flex flex-wrap gap-2">
				{#each element.items as item, si (`s${si}`)}
					<div
						class="min-w-20 rounded-xl border border-foreground/5 bg-[#fffdf7] px-4 py-2.5 shadow-[0_1px_3px_rgba(30,41,59,0.06)]"
					>
						<p class="font-semibold text-lg leading-tight">
							{stat(keeper.records ?? [], item)}
						</p>
						<p class="text-[0.625rem] text-foreground/40 uppercase tracking-wide">
							{item.label}
						</p>
					</div>
				{/each}
			</div>
		{:else if element.kind === 'records'}
			<div class="flex flex-col gap-2">
				{#if element.title}
					<h3 class="font-semibold text-[13px] text-foreground/60">{element.title}</h3>
				{/if}
				{#if !keeper.records || keeper.records.length === 0}
					<p class="text-[13px] text-foreground/30">Nothing here yet — just say what to add.</p>
				{:else}
					<ul class="space-y-2">
						{#each keeper.records as record (record.id)}
							{@const c = card(record.data, element.item)}
							<li
								class="group rounded-2xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.06),0_4px_12px_rgba(30,41,59,0.04)] transition-shadow hover:shadow-[0_2px_6px_rgba(30,41,59,0.08),0_8px_20px_rgba(30,41,59,0.06)]"
							>
								<div class="flex items-start gap-3">
									<div class="flex min-w-0 flex-1 flex-col gap-1">
										<div class="flex flex-wrap items-center gap-2">
											{#if c.title}
												<span class="font-medium leading-snug">{c.title}</span>
											{/if}
											{#each c.badges as badge, bi (`b${bi}`)}
												<span
													class="rounded-full px-2 py-0.5 font-medium text-[0.625rem] {badge.done
														? 'bg-status-success/10 text-status-success'
														: 'bg-foreground/5 text-foreground/50'}"
												>
													{badge.text}
												</span>
											{/each}
										</div>
										{#if c.subtitle && c.subtitle !== c.title}
											<p class="text-[13px] text-foreground/50 leading-snug">{c.subtitle}</p>
										{/if}
										{#if c.progress !== undefined}
											<div class="flex items-center gap-2 pt-0.5">
												<span class="h-1.5 w-28 overflow-hidden rounded-full bg-foreground/10">
													<span
														class="block h-full rounded-full bg-status-success transition-[width]"
														style="width: {c.progress}%"
													></span>
												</span>
												<span class="text-[0.6875rem] text-foreground/40">
													{Math.round(c.progress)}%
												</span>
											</div>
										{/if}
										{#if c.meta.length > 0}
											<p class="text-[0.6875rem] text-foreground/40">{c.meta.join(' · ')}</p>
										{/if}
										{#if c.rest.length > 0 && !c.title}
											{#each c.rest as [key, value] (key)}
												<div class="flex items-baseline gap-2">
													<span class="shrink-0 font-mono text-[0.625rem] text-foreground/35">
														{key}
													</span>
													<span class="min-w-0 flex-1 break-words leading-snug">{value}</span>
												</div>
											{/each}
										{:else if c.rest.length > 0}
											<p class="text-[0.6875rem] text-foreground/35">
												{c.rest.map(([k, v]) => `${k}: ${v}`).join(' · ')}
											</p>
										{/if}
									</div>
									<button
										type="button"
										onclick={() => keeper.forget(record.id)}
										class="shrink-0 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
										aria-label="Delete"
									>
										×
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/each}
</div>
