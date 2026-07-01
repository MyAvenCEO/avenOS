<script lang="ts">
import Composer from '$lib/composer/Composer.svelte'
import { t } from '$lib/i18n'
import TodosVibe from '$lib/shell/TodosVibe.svelte'

// Mainnet "Vibes" tab: a left "select vibe" rail + the selected vibe. board 0099 stripped
// avenOS back to a resilient core — the one Todos skill (an actor hub) + the website Composer.
const VIBES: { id: string; label: string }[] = [
	{ id: 'todos', label: t('mainnet.todos.title') },
	{ id: 'composer', label: t('mainnet.nav.composer') }
]
let selectedVibe = $state('todos')
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: select vibe viewer -->
	<aside class="border-border hidden w-48 shrink-0 flex-col border-r pt-3 sm:flex">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			{t('mainnet.vibes.select')}
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto px-2">
			{#each VIBES as v (v.id)}
				<button
					type="button"
					class="mb-0.5 block w-full truncate rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {v.id ===
					selectedVibe
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (selectedVibe = v.id)}
				>
					{v.label}
				</button>
			{/each}
		</div>
	</aside>

	<!-- Right: the selected vibe (Composer renders full-bleed — it has its own chrome) -->
	<div class="flex min-h-0 flex-1 flex-col">
		{#if selectedVibe === 'todos'}
			<div class="flex min-h-0 flex-1 flex-col p-4">
				<TodosVibe containerName="aven-vibes-tab-todos" />
			</div>
		{:else if selectedVibe === 'composer'}
			<Composer />
		{/if}
	</div>
</div>
