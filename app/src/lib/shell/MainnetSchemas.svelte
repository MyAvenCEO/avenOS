<script lang="ts">
import { type DataSchema, listSchemas } from '$lib/data/client'
import { t } from '$lib/i18n'

// Mainnet "Schemas" tab: a left "select schema" rail (same shape as Vibes) + the selected
// schema's JSON Schema, pretty-printed on the right. Read-only viewer over /api/data. board 0053.
let schemas = $state<DataSchema[]>([])
let selectedId = $state<string | null>(null)
let err = $state<string | null>(null)
let started = false

const selected = $derived(schemas.find((s) => s.id === selectedId) ?? null)

async function load(): Promise<void> {
	try {
		schemas = await listSchemas()
		if (schemas.length > 0 && !selectedId) selectedId = schemas[0].id
	} catch (e) {
		err = e instanceof Error ? e.message : String(e)
	}
}

$effect(() => {
	if (started) return
	started = true
	void load()
})
</script>

<div class="flex min-h-0 flex-1">
	<!-- Left: select schema -->
	<aside class="border-border hidden w-48 shrink-0 flex-col border-r pt-3 sm:flex">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			{t('mainnet.schemas.select')}
		</p>
		<div class="min-h-0 flex-1 overflow-y-auto px-2">
			{#if schemas.length === 0}
				<p class="text-muted-foreground px-2 py-2 text-[11px] leading-relaxed">
					{t('mainnet.schemas.empty')}
				</p>
			{/if}
			{#each schemas as s (s.id)}
				<button
					type="button"
					class="mb-0.5 block w-full truncate rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {s.id ===
					selectedId
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (selectedId = s.id)}
				>
					{s.name}
				</button>
			{/each}
		</div>
	</aside>

	<!-- Right: the selected schema's JSON -->
	<div class="flex min-h-0 flex-1 flex-col p-4">
		{#if err}
			<p class="text-destructive shrink-0 text-sm" role="alert">{err}</p>
		{/if}
		{#if selected}
			<div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
				<div class="shrink-0 pb-2">
					<p class="text-muted-foreground text-[10px] font-bold tracking-[0.14em] uppercase">
						{t('mainnet.schemas.title')}
					</p>
					<h2 class="text-foreground text-lg font-semibold">{selected.name}</h2>
				</div>
				<pre
					class="border-border bg-card text-foreground min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border p-4 text-[12px] leading-relaxed"
				><code
						>{JSON.stringify(selected.jsonSchema, null, 2)}</code
					></pre>
			</div>
		{/if}
	</div>
</div>
