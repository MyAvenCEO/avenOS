<script lang="ts">
// board 0100 — the ontology actor's vibe: `read` lists the existing x1–x5 predicate registry; `created`
// shows the freshly-minted predicate (its gismu + FULL place structure) or a "reused existing" note.
type Place = {
	pos: string
	role: string
	gloss?: string
	kind?: string
	type?: string
	required?: boolean
}
type Predicate = { predicate: string; gismu?: string | null; gloss?: string; places?: Place[] }
let {
	mode = 'read',
	data
}: {
	mode?: 'read' | 'created'
	data?: { predicates?: { name: string; gloss?: string }[]; created?: Predicate; reused?: string }
} = $props()

const predicates = $derived(data?.predicates ?? [])
const created = $derived<Predicate | undefined>(data?.created)
const reused = $derived(data?.reused)
</script>

<div class="mx-auto w-full max-w-2xl">
	{#if mode === 'created'}
		{#if reused}
			<header class="mb-3 flex items-center gap-2">
				<span class="bg-primary size-2 rounded-full"></span>
				<span class="text-primary text-[11px] font-bold tracking-[0.14em] uppercase"
					>Wiederverwendet</span
				>
				<span class="text-muted-foreground text-[11px]">· vorhandenes Prädikat</span>
			</header>
			<div class="border-border bg-card rounded-[var(--radius-lg)] border px-4 py-3">
				<p class="text-foreground text-sm font-semibold">{reused}</p>
				<p class="text-muted-foreground mt-1 text-[12px]">
					Ein passendes Prädikat existierte bereits — kein Duplikat angelegt.
				</p>
			</div>
		{:else if created}
			<header class="mb-3 flex items-center gap-2">
				<span class="size-2 rounded-full bg-green-600"></span>
				<span class="text-[11px] font-bold tracking-[0.14em] text-green-700 uppercase"
					>Neues Prädikat</span
				>
				<span class="text-muted-foreground text-[11px]">· {created.places?.length ?? 0} Plätze</span>
			</header>
			<div class="border-border bg-card rounded-[var(--radius-lg)] border px-4 py-3">
				<p class="text-foreground text-sm font-semibold">
					{created.predicate}
					{#if created.gismu}
						<span class="text-muted-foreground font-mono text-[12px]">· {created.gismu}</span>
					{/if}
				</p>
				{#if created.gloss}
					<p class="text-muted-foreground mt-0.5 text-[12px]">{created.gloss}</p>
				{/if}
				<ul class="border-border/60 divide-border/60 mt-2 divide-y">
					{#each created.places ?? [] as p (p.pos)}
						<li class="flex items-baseline gap-2.5 py-1.5 text-[12px]">
							<span class="text-primary w-7 shrink-0 font-mono font-semibold">{p.pos}</span>
							<span class="text-foreground shrink-0 font-medium">{p.role}</span>
							<span class="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
								>{p.kind}{p.type ? `:${p.type}` : ''}{p.required === false ? ' · opt' : ''}</span
							>
							{#if p.gloss}<span class="text-muted-foreground truncate">{p.gloss}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else}
		<header class="mb-3 flex items-center gap-2">
			<span class="bg-foreground size-2 rounded-full"></span>
			<span class="text-foreground text-[11px] font-bold tracking-[0.14em] uppercase">Ontologie</span>
			<span class="text-muted-foreground text-[11px]"
				>· {predicates.length} Prädikate</span
			>
		</header>
		{#if predicates.length === 0}
			<p
				class="text-muted-foreground border-border rounded-[var(--radius-lg)] border border-dashed px-4 py-6 text-center text-sm"
			>
				Noch keine Beziehungstypen — beschreibe eine, um sie anzulegen.
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each predicates as p (p.name)}
					<li
						class="border-border bg-card flex items-baseline justify-between gap-3 rounded-[var(--radius-lg)] border px-4 py-2.5"
					>
						<span class="text-foreground font-mono text-[13px] font-medium">{p.name}</span>
						{#if p.gloss}<span class="text-muted-foreground truncate text-[12px]">{p.gloss}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
