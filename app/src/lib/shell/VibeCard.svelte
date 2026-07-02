<script lang="ts">
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { createQuery } from '@tanstack/svelte-query'
import { loadVibeBundle } from '$lib/data/client'

// board 0105 — the ONE generic vibe host. Any chat/Runs card renders from its vibe.* registry rows
// (vibe_view / vibe_style / vibe_logic) through the SAME engine the todos `all` card uses (AvenVibeView +
// the QuickJS sandbox), with the card's `data` fed in as the vibe `source`. No per-card Svelte — a card's
// look is config-as-data, changeable without a rebuild. Read-only summary cards need no event wiring.
let {
	schema,
	data = {},
	containerName = 'aven-vibe-card'
}: { schema: string; data?: Record<string, unknown>; containerName?: string } = $props()

// A vibe bundle is the same for everyone (admin-owned config) — cache by schema name. board 0095/0105.
const bundle = createQuery(() => ({
	queryKey: ['vibe', schema],
	queryFn: () => loadVibeBundle(schema),
	staleTime: 5 * 60_000
}))
// The engine renders a UiFixtureShell = view/style/logic (+ a minimal interface); state comes from the
// QuickJS initState(source). A generic card needs no per-card shell factory — just the bundle + the data.
const shell = $derived(
	bundle.data
		? {
				view: bundle.data.view as never,
				style: bundle.data.style as never,
				logic: bundle.data.logic,
				source: {},
				interface: {}
			}
		: null
)
</script>

{#if shell}
	<div class="mx-auto w-full max-w-2xl">
		<AvenVibeView {shell} source={data} {containerName} />
	</div>
{:else if bundle.isError}
	<p class="text-destructive text-sm" role="alert">Vibe „{schema}“ konnte nicht geladen werden.</p>
{/if}
