<script lang="ts">
import { ask, edges } from './model'
import { registry } from './registry'

/**
 * The declared population — the "skills" view after the collapse: every
 * card is an actor; a coordinator lists its members and the edges the
 * manifests IMPLY (provides ∩ requires). Nothing here stores a graph:
 * what you see is derivation, the abject way.
 */
const coordinators = registry.filter((a) => (a.members?.length ?? 0) > 0)
const leaf = (id: string) => registry.find((a) => a.id === id)
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
	<header class="flex flex-col gap-1">
		<h2 class="font-display font-semibold text-lg">The mesh, declared</h2>
		<p class="text-foreground/60 text-sm">
			One primitive: the actor. A "skill" is an actor with members; the wiring below is not stored —
			it emerges from provides ∩ requires, message by message.
		</p>
	</header>

	<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
		{#each coordinators as c (c.id)}
			<article class="flex flex-col gap-3 rounded-2xl border border-border bg-surface-card p-4">
				<header class="flex flex-wrap items-baseline gap-2">
					<h3 class="font-semibold text-sm">{c.manifest.name}</h3>
					<span class="font-mono text-[0.625rem] text-foreground/35">{c.id}</span>
					<span class="ml-auto font-mono text-[0.625rem] text-foreground/45">
						{c.manifest.requires?.join(' · ')}
						→ {c.manifest.provides?.join(' · ')}
					</span>
				</header>
				<p class="text-foreground/60 text-xs leading-relaxed">{c.manifest.about}</p>

				<div class="flex flex-col gap-1.5 border-border/60 border-t pt-3">
					{#each c.members ?? [] as m (m)}
						{@const a = leaf(m)}
						<div class="flex items-baseline gap-2 text-xs" title={a ? ask(a) : m}>
							<span class="w-28 shrink-0 font-medium">{a?.manifest.name ?? m}</span>
							<span class="truncate text-foreground/50">{a?.manifest.about}</span>
							<span class="ml-auto shrink-0 font-mono text-[0.5625rem] text-foreground/35">
								{a?.manifest.type ?? ((a?.members?.length ?? 0) > 0 ? 'coordinator' : '')}
							</span>
						</div>
					{/each}
				</div>

				<div class="flex flex-wrap gap-x-4 gap-y-1 border-border/60 border-t pt-2">
					{#each edges(registry, c.id) as e (e.from + e.to + e.functor)}
						<span class="font-mono text-[0.625rem] text-foreground/40">
							{leaf(e.from)?.manifest.name}
							<span class="text-foreground/25">─{e.functor}→</span>
							{leaf(e.to)?.manifest.name}
						</span>
					{/each}
				</div>
			</article>
		{/each}
	</div>
</div>
