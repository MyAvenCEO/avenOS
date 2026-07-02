<script lang="ts">
// board 0102 — the bundle actor's vibe: a freshly-authored composite type (a KIND). Shows the bundle name,
// its traits (which predicate each plays + how), and its view (the flat fields it reads back), plus any
// predicates that had to be minted for it. The raw spec is a collapsible so the mechanics stay transparent.
type Trait = { pred?: string; kind?: string; field?: string; link?: string }
type Read = { pred?: string; place?: string; notNull?: string; children?: boolean }
type Spec = { type?: string; parts?: Trait[]; project?: Record<string, Read> }
let {
	data
}: {
	data?: { request?: string; spec?: Spec; mintedPredicates?: string[] }
} = $props()

const spec = $derived<Spec>(data?.spec ?? {})
const traits = $derived<Trait[]>(Array.isArray(spec.parts) ? spec.parts : [])
const view = $derived<[string, Read][]>(Object.entries(spec.project ?? {}))
const minted = $derived<string[]>(
	Array.isArray(data?.mintedPredicates) ? data.mintedPredicates : []
)
const specText = $derived(spec ? JSON.stringify(spec, null, 2) : '')
let showSpec = $state(false)

function readOf(r: Read): string {
	if (r.notNull) return `${r.pred}.${r.notNull} present?`
	if (r.children) return `${r.pred}[]`
	return `${r.pred}.${r.place ?? '?'}`
}
</script>

<div class="mx-auto w-full max-w-2xl">
	<header class="mb-3 flex items-center gap-2">
		<span class="size-2 rounded-full bg-green-600"></span>
		<span class="text-[11px] font-bold tracking-[0.14em] text-green-700 uppercase">Neuer Typ</span>
		<span class="text-foreground font-mono text-[13px] font-semibold">{spec.type ?? '—'}</span>
		<span class="text-muted-foreground text-[11px]"
			>· {traits.length} Traits · {view.length} Felder</span
		>
	</header>

	{#if data?.request}
		<p class="text-muted-foreground mb-3 text-[13px] italic">„{data.request}“</p>
	{/if}

	<div class="border-border bg-card rounded-[var(--radius-lg)] border p-4">
		<!-- traits: which predicate each plays + how -->
		<p class="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
			Traits
		</p>
		<ul class="divide-border/60 divide-y">
			{#each traits as t (t.pred + (t.field ?? ''))}
				<li class="flex items-baseline gap-2.5 py-1.5 text-[12px]">
					<span class="text-foreground shrink-0 font-mono font-medium">{t.pred}</span>
					<span
						class="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
						>{t.kind}</span
					>
					{#if t.field}
						<span class="text-muted-foreground truncate">← {t.field}</span>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- view: the flat fields it reads back -->
		<p class="text-muted-foreground mt-3 mb-1.5 text-[10px] font-semibold tracking-wide uppercase">
			View
		</p>
		<div class="flex flex-wrap gap-1.5">
			{#each view as [ field, r ] (field)}
				<span class="border-border rounded-full border px-2 py-0.5 text-[11px]">
					<span class="text-foreground font-medium">{field}</span>
					<span class="text-muted-foreground font-mono">= {readOf(r)}</span>
				</span>
			{/each}
		</div>
	</div>

	{#if minted.length}
		<p class="text-muted-foreground mt-2 text-[12px]">
			+ {minted.length} neues Prädikat{minted.length === 1 ? '' : 'e'}
			geprägt:
			<span class="text-foreground font-mono">{minted.join(', ')}</span>
		</p>
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
