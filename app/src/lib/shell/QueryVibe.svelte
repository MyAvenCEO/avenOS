<script lang="ts">
// board 0101 — the dynamic query/mutate actors' vibe. `query` shows the answer to a question plain CRUD
// can't answer (the returned rows) + the GLM-authored spec that produced it; `mutate` shows the structural
// change that was applied (the transaction's insert/delete ops) + its spec. The spec is collapsed by
// default so the mechanics are transparent-on-demand, never noisy.
type Op = { op?: string; predicate?: string; affected?: number }
let {
	mode = 'query',
	data
}: {
	mode?: 'query' | 'mutation'
	data?: {
		request?: string
		spec?: unknown
		rows?: Record<string, unknown>[]
		ops?: Op[]
	}
} = $props()

const request = $derived(data?.request ?? '')
const rows = $derived<Record<string, unknown>[]>(Array.isArray(data?.rows) ? data.rows : [])
const ops = $derived<Op[]>(Array.isArray(data?.ops) ? data.ops : [])
// union of every row's keys, in first-seen order → the table columns.
const columns = $derived.by<string[]>(() => {
	const seen: string[] = []
	for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k)
	return seen
})
const specText = $derived(data?.spec ? JSON.stringify(data.spec, null, 2) : '')
let showSpec = $state(false)
function cell(v: unknown): string {
	return v === null || v === undefined ? '—' : String(v)
}
</script>

<div class="mx-auto w-full max-w-2xl">
	<header class="mb-3 flex items-center gap-2">
		<span
			class="{mode === 'mutation' ? 'bg-amber-600' : 'bg-foreground'} size-2 rounded-full"
		></span>
		<span class="text-foreground text-[11px] font-bold tracking-[0.14em] uppercase"
			>{mode === 'mutation' ? 'Mutation' : 'Abfrage'}</span
		>
		{#if mode === 'query'}
			<span class="text-muted-foreground text-[11px]">· {rows.length} Treffer</span>
		{:else}
			<span class="text-muted-foreground text-[11px]"
				>· {ops.length} {ops.length === 1 ? 'Schritt' : 'Schritte'}</span
			>
		{/if}
	</header>

	{#if request}
		<p class="text-muted-foreground mb-3 text-[13px] italic">„{request}“</p>
	{/if}

	{#if mode === 'query'}
		{#if rows.length === 0}
			<p
				class="text-muted-foreground border-border rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-sm"
			>
				Keine Treffer.
			</p>
		{:else}
			<div class="border-border bg-card overflow-x-auto rounded-[var(--radius-lg)] border">
				<table class="w-full text-left text-[12px]">
					<thead class="text-muted-foreground border-border/60 border-b">
						<tr>
							{#each columns as c (c)}
								<th class="px-3 py-2 font-mono font-semibold">{c}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-border/60 divide-y">
						{#each rows as r, i (i)}
							<tr>
								{#each columns as c (c)}
									<td class="text-foreground px-3 py-1.5">{cell(r[c])}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<ul class="flex flex-col gap-2">
			{#each ops as o, i (i)}
				<li
					class="border-border bg-card flex items-center gap-2.5 rounded-[var(--radius-lg)] border px-4 py-2.5"
				>
					<span
						class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {o.op === 'delete'
							? 'bg-red-100 text-red-700'
							: 'bg-green-100 text-green-700'}"
						>{o.op === 'delete' ? '− delete' : '+ insert'}</span
					>
					<span class="text-foreground font-mono text-[13px] font-medium">{o.predicate}</span>
					{#if typeof o.affected === 'number'}
						<span class="text-muted-foreground text-[12px]"
							>· {o.affected} {o.affected === 1 ? 'Zeile' : 'Zeilen'}</span
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if specText}
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground mt-2 text-[11px] underline decoration-dotted"
			onclick={() => (showSpec = !showSpec)}
		>
			{showSpec ? 'Spec ausblenden' : 'Spec anzeigen'}
		</button>
		{#if showSpec}
			<pre
				class="border-border bg-muted/40 text-muted-foreground mt-1 overflow-x-auto rounded-[var(--radius-md)] border px-3 py-2 text-[11px]"
			>{specText}</pre>
		{/if}
	{/if}
</div>
