<script lang="ts">
	import type { IntentActorNode } from './types'

	let {
		actors,
		selectedActorId,
		onSelectActor
	}: {
		actors: IntentActorNode[]
		selectedActorId: string
		onSelectActor: (actorId: string) => void
	} = $props()

	const depthMap = $derived.by(() => {
		const map = new Map<string, number>()
		function depthFor(actorId: string): number {
			if (map.has(actorId)) return map.get(actorId) ?? 0
			const actor = actors.find((entry) => entry.actorId === actorId)
			if (!actor?.uiParentActorId) {
				map.set(actorId, 0)
				return 0
			}
			const depth = depthFor(actor.uiParentActorId) + 1
			map.set(actorId, depth)
			return depth
		}
		for (const actor of actors) depthFor(actor.actorId)
		return map
	})
</script>

<section class="flex h-full min-h-0 w-full flex-col border-l border-border/50 pl-2">
	<div class="mb-1.5 flex shrink-0 items-center gap-2">
		<span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Involved actors</span>
	</div>
	<nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5" aria-label="Select actor">
		{#each actors as actor (actor.actorId)}
			<button
				type="button"
				class={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${selectedActorId === actor.actorId ? 'border-foreground/20 bg-background/90' : 'border-border/40 bg-background/40 hover:bg-background/70'}`}
				onclick={() => onSelectActor(actor.actorId)}
				style={`padding-left:${0.5 + (depthMap.get(actor.actorId) ?? 0) * 0.9}rem`}
			>
				<div class="text-[11px] font-semibold leading-snug">{actor.label}</div>
				<div class="text-[9px] opacity-55 line-clamp-1">{actor.subtitle ?? actor.actorId}</div>
			</button>
		{/each}
	</nav>
</section>