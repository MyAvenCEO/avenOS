<script lang="ts">
import {
	type ActorStep,
	type FlowTemplate,
	functor,
	producedFunctors,
	stages,
	TEMPLATES
} from './template'

/**
 * The recipe, readable: inputs on the left as the flow's facts, actor stages
 * derived by the rule solver in the middle, outputs on the right as its
 * goals. Nothing here is wired by hand — the columns ARE the solution the
 * solver found, and a predicate wears one color wherever it appears, so
 * producer and consumer link by eye without edge lines.
 *
 * Composition is walkable: an actor that is itself a flow carries a badge
 * and a click descends into it; the trail at the top climbs back up.
 */

let current = $state<FlowTemplate>(TEMPLATES[0])
/** The composition trail down from the root — click to climb back. */
let trail = $state<FlowTemplate[]>([])

const solved = $derived(stages(current))
const satisfied = $derived(producedFunctors(current))

/** A stable, calm palette; a functor hashes to one hue everywhere. */
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

function open(flow: FlowTemplate) {
	trail = []
	current = flow
}

function descend(step: ActorStep) {
	const sub = TEMPLATES.find((t) => t.id === step.flow)
	if (!sub) return
	trail = [...trail, current]
	current = sub
}

function climb(to: number) {
	current = trail[to]
	trail = trail.slice(0, to)
}
</script>

{#snippet pill(predicate: string)}
	<span class="rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem] {hue(predicate)}">
		{predicate}
	</span>
{/snippet}

<div class="flex min-h-0 flex-1 gap-5 text-foreground">
	<!-- The recipe book: every flow, grouped by the skill it belongs to. -->
	<nav class="flex w-44 shrink-0 flex-col gap-1 text-sm">
		<p class="px-2 pb-1 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">Flows</p>
		{#each TEMPLATES as flow (flow.id)}
			<button
				type="button"
				onclick={() => open(flow)}
				class="rounded-xl px-3 py-2 text-left transition-colors {current.id === flow.id
					? 'bg-[#fffdf7] border border-foreground/5'
					: 'opacity-60 hover:opacity-100'}"
			>
				<span class="block leading-tight">{flow.name}</span>
				<span class="block text-[0.6875rem] text-foreground/40">{flow.skill}</span>
			</button>
		{/each}
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
		<!-- Where we are in the composition, and the way back up. -->
		<div class="flex items-baseline gap-2 text-sm">
			{#each trail as parent, i (parent.id)}
				<button
					type="button"
					onclick={() => climb(i)}
					class="opacity-50 underline underline-offset-4 hover:opacity-100"
				>
					{parent.name}
				</button>
				<span class="opacity-30">▸</span>
			{/each}
			<span class="font-semibold">{current.name}</span>
			<span class="text-foreground/40 text-xs">{current.description}</span>
		</div>

		<div class="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto pb-2">
			<!-- Facts: what the world asserts into this flow. -->
			<section
				class="flex w-40 shrink-0 flex-col gap-2 rounded-2xl border border-foreground/5 bg-surface-soft/60 p-2.5"
			>
				<h3 class="px-1 text-[0.6875rem] text-foreground/50 uppercase tracking-wide">Inputs</h3>
				{#each current.inputs as port (port.id)}
					<div class="rounded-xl border border-foreground/5 bg-[#fffdf7] px-3 py-2">
						<span class="block pb-1 font-medium text-sm leading-tight">{port.label}</span>
						{@render pill(port.predicate)}
					</div>
				{/each}
			</section>

			<span class="self-center text-foreground/25 text-lg">→</span>

			<!-- The solver's answer: actors in the order their requirements resolve. -->
			{#each solved as stage, i (i)}
				<section
					class="flex w-52 shrink-0 flex-col gap-2 rounded-2xl border border-foreground/5 bg-surface-soft/60 p-2.5"
				>
					<h3 class="px-1 text-[0.6875rem] text-foreground/50 uppercase tracking-wide">
						Stufe {i + 1}
					</h3>
					{#each stage as actor (actor.id)}
						{@const composite = actor.flow !== undefined}
						<svelte:element
							this={composite ? 'button' : 'div'}
							role={composite ? 'button' : undefined}
							onclick={composite ? () => descend(actor) : undefined}
							class="rounded-xl border border-foreground/5 bg-[#fffdf7] px-3 py-2.5 text-left {composite
								? 'cursor-pointer transition-colors hover:border-primary/30'
								: ''}"
						>
							<div class="flex items-center gap-2 pb-1.5">
								<span class="font-medium text-sm leading-tight">{actor.name}</span>
								{#if composite}
									<span
										class="rounded-md bg-primary/8 px-1.5 py-0.5 text-[0.625rem] text-primary/70"
									>
										▸ Flow
									</span>
								{/if}
							</div>
							<div class="flex flex-wrap items-center gap-1">
								{#each actor.requires as r (r)}
									{@render pill(r)}
								{/each}
								<span class="px-0.5 text-foreground/30 text-xs">→</span>
								{#each actor.produces as p (p)}
									{@render pill(p)}
								{/each}
							</div>
						</svelte:element>
					{/each}
				</section>

				<span class="self-center text-foreground/25 text-lg">→</span>
			{/each}

			<!-- Goals: what this flow promises outward. An output whose predicate no
			     actor produces is a broken promise and shows as such. -->
			<section
				class="flex w-40 shrink-0 flex-col gap-2 rounded-2xl border border-foreground/5 bg-surface-soft/60 p-2.5"
			>
				<h3 class="px-1 text-[0.6875rem] text-foreground/50 uppercase tracking-wide">Outputs</h3>
				{#each current.outputs as port (port.id)}
					{@const ok = satisfied.has(functor(port.predicate))}
					<div
						class="rounded-xl border bg-[#fffdf7] px-3 py-2 {ok
							? 'border-foreground/5'
							: 'border-status-error/40'}"
					>
						<span class="block pb-1 font-medium text-sm leading-tight">{port.label}</span>
						{@render pill(port.predicate)}
						{#if !ok}
							<span class="block pt-1 text-[0.625rem] text-status-error">unerfüllt</span>
						{/if}
					</div>
				{/each}
			</section>
		</div>
	</div>
</div>
