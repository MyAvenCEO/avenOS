<script lang="ts">
/**
 * The brand palette, read from the running theme rather than retyped: each
 * swatch paints itself with its own CSS variable and reports the value the
 * browser actually resolved. Change a token in app.css and this page tells
 * the truth on the next reload — a surface for shaping the palette, not a
 * copy of it that drifts.
 */

interface Token {
	token: string
	name: string
	note: string
}

interface Group {
	title: string
	about: string
	tokens: Token[]
}

const GROUPS: Group[] = [
	{
		title: 'Primär',
		about: 'Was die Marke trägt — Navy führt, Creme hält den Grund.',
		tokens: [
			{
				token: '--color-brand-navy',
				name: 'Marine',
				note: 'primary · Voice-Pill, HITL, aktive Chips'
			},
			{
				token: '--color-primary-soft',
				name: 'Marine soft',
				note: 'Akzent-Chrom, wo Navy erschlägt'
			},
			{
				token: '--color-secondary',
				name: 'Creme-Gelb',
				note: 'secondary · warme Aktion auf Navy-Text'
			},
			{
				token: '--color-surface-cream',
				name: 'Seiten-Creme',
				note: 'der Grund, auf dem alles liegt'
			},
			{ token: '--color-surface-soft', name: 'Eierschale weich', note: 'Display-Flächen' },
			{ token: '--color-surface-card', name: 'Karte', note: 'Ruhezustand' },
			{ token: '--color-surface-card-selected', name: 'Karte gewählt', note: 'Auswahl-Highlight' }
		]
	},
	{
		title: 'Status',
		about: 'Die Zustände, die der Intent-Stream als 3px-Kante trägt.',
		tokens: [
			{ token: '--color-status-success-base', name: 'Moos', note: 'done · erledigt' },
			{
				token: '--color-status-working-base',
				name: 'Salbei',
				note: 'working — heute nutzt der Stream Amber'
			},
			{ token: '--color-status-error-base', name: 'Terracotta', note: 'error · abgelehnt' },
			{ token: '--color-status-info-base', name: 'Sand', note: 'info · Spark „Me"' },
			{
				token: '--color-status-pairing-base',
				name: 'Violett',
				note: 'pairing · Spark „Team", Brain'
			}
		]
	},
	{
		title: 'Benannte Töne',
		about: 'Die Namen, die wir sprechen — mehrere zeigen auf dieselbe Basis.',
		tokens: [
			{ token: '--color-marine', name: 'marine', note: '→ primary' },
			{ token: '--color-tuscan-sun', name: 'tuscan sun', note: '→ coffee (war: Sonnengelb)' },
			{ token: '--color-paradise-water', name: 'paradise water', note: '→ shadow (war: Türkis)' },
			{ token: '--color-moss', name: 'moss', note: '→ lunar green' },
			{ token: '--color-terracotta', name: 'terracotta', note: '→ nutmeg' },
			{ token: '--color-coffee', name: 'coffee', note: '→ brand navy' },
			{ token: '--color-driftwood', name: 'driftwood', note: '→ archive / mercury' },
			{ token: '--color-palette-shadow', name: 'shadow', note: 'warmes Grau' }
		]
	}
]

/** What the browser resolved, per token — the honest value. */
let resolved = $state<Record<string, string>>({})

$effect(() => {
	const style = getComputedStyle(document.documentElement)
	const next: Record<string, string> = {}
	for (const group of GROUPS) {
		for (const t of group.tokens) next[t.token] = style.getPropertyValue(t.token).trim()
	}
	resolved = next
})

/**
 * Two tokens that resolve to the same value are the same colour wearing two
 * names — worth seeing while shaping the palette.
 */
const duplicates = $derived.by(() => {
	const seen = new Map<string, string[]>()
	for (const [token, value] of Object.entries(resolved)) {
		if (!value) continue
		seen.set(value, [...(seen.get(value) ?? []), token])
	}
	return [...seen.entries()].filter(([, tokens]) => tokens.length > 1)
})
</script>

<div class="flex flex-col gap-6">
	<div>
		<h2 class="font-semibold text-sm">Brand-Farben</h2>
		<p class="pt-1 text-foreground/50 text-xs">
			Gelesen aus dem laufenden Theme — jede Fläche malt sich mit ihrem eigenen Token.
		</p>
	</div>

	{#each GROUPS as group (group.title)}
		<section class="flex flex-col gap-2">
			<div>
				<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
					{group.title}
				</h3>
				<p class="pt-0.5 text-[0.6875rem] text-foreground/40">{group.about}</p>
			</div>
			<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
				{#each group.tokens as t (t.token)}
					<li
						class="flex items-center gap-3 rounded-xl border border-foreground/5 bg-[#fffdf7] px-3 py-2.5 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						<span
							class="size-9 shrink-0 rounded-lg border border-foreground/10"
							style="background: var({t.token})"
						></span>
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="font-medium text-xs">{t.name}</span>
								<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/45">
									{resolved[t.token] || '—'}
								</span>
							</div>
							<p class="truncate text-[0.625rem] text-foreground/40">{t.note}</p>
							<p class="truncate font-mono text-[0.5625rem] text-foreground/30">{t.token}</p>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if duplicates.length > 0}
		<section class="flex flex-col gap-2">
			<div>
				<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
					Gleiche Farbe, mehrere Namen
				</h3>
				<p class="pt-0.5 text-[0.6875rem] text-foreground/40">
					Kandidaten fürs Aufräumen — oder für eigene Töne.
				</p>
			</div>
			<ul class="flex flex-col gap-1.5">
				{#each duplicates as [value, tokens] (value)}
					<li
						class="flex items-center gap-3 rounded-xl border border-foreground/5 bg-[#fffdf7] px-3 py-2"
					>
						<span
							class="size-5 shrink-0 rounded-md border border-foreground/10"
							style="background: {value}"
						></span>
						<span class="shrink-0 font-mono text-[0.625rem] text-foreground/45">{value}</span>
						<span class="min-w-0 flex-1 truncate font-mono text-[0.625rem] text-foreground/35">
							{tokens.join(' · ')}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
