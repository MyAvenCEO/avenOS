<script lang="ts">
/**
 * The brand palette, read from the running theme rather than retyped: every
 * swatch paints itself with its own CSS variable and reports the value the
 * browser actually resolved. Change a token in app.css and this page tells
 * the truth on the next reload — a surface for shaping the palette, not a
 * copy of it that drifts.
 *
 * It is laid out the way the palette is now built (app.css, blocks 1–4):
 * tones are the paint, roles are the meaning, surfaces are the ground. The
 * mapping table comes first because that is the part worth arguing about.
 */

interface Role {
	role: string
	tone: string
	token: string
	toneToken: string
	note: string
}

interface Tone {
	name: string
	token: string
	note: string
}

/**
 * Block 3 of app.css, mirrored: the design-system role on the left, the brand
 * tone that carries it on the right. One tone may serve several roles; no role
 * may name a hex.
 */
const ROLES: Role[] = [
	{
		role: 'primary',
		tone: 'Marine',
		token: '--color-primary',
		toneToken: '--color-marine',
		note: 'Buttons, Rail, HITL-Rahmen'
	},
	{
		role: 'primary soft',
		tone: 'Hafen',
		token: '--color-primary-soft',
		toneToken: '--color-harbour',
		note: 'Chrom, wo Marine erschlägt'
	},
	{
		role: 'secondary',
		tone: 'Pergament',
		token: '--color-secondary',
		toneToken: '--color-parchment',
		note: 'die warme zweite Aktion'
	},
	{
		role: 'error',
		tone: 'Terracotta',
		token: '--color-status-error',
		toneToken: '--color-terracotta',
		note: 'ein Gate ist gescheitert'
	},
	{
		role: 'warning',
		tone: 'Tuscan Sun',
		token: '--color-status-warning',
		toneToken: '--color-tuscan-sun',
		note: 'working — es bewegt sich etwas'
	},
	{
		role: 'info',
		tone: 'Sonnenblume',
		token: '--color-status-info',
		toneToken: '--color-sunflower',
		note: 'Hinweis ohne Handlung'
	},
	{
		role: 'success',
		tone: 'Moos',
		token: '--color-status-success',
		toneToken: '--color-moss',
		note: 'erledigt, abgelegt'
	},
	{
		role: 'working',
		tone: 'Salbei',
		token: '--color-status-working',
		toneToken: '--color-sage',
		note: 'Fläche in Arbeit (dunkler Text darauf)'
	},
	{
		role: 'waiting',
		tone: 'Paradise Water',
		token: '--color-status-waiting',
		toneToken: '--color-paradise-water',
		note: 'offenes Human-Gate (HITL)'
	},
	{
		role: 'pairing',
		tone: 'Iris',
		token: '--color-status-pairing',
		toneToken: '--color-iris',
		note: 'Geräte-Pairing'
	},
	{
		role: 'archive',
		tone: 'Driftwood',
		token: '--color-status-archive',
		toneToken: '--color-driftwood',
		note: 'aus dem Weg, noch lesbar'
	},
	{
		role: 'neutral',
		tone: 'Stein',
		token: '--color-neutral',
		toneToken: '--color-stone',
		note: 'ruhiges Chrom'
	}
]

/** Block 1: the paint itself, each hex written exactly once in app.css. */
const TONES: Tone[] = [
	{ name: 'Marine', token: '--color-marine', note: 'tiefes Navy — Tinte und Fläche' },
	{ name: 'Hafen', token: '--color-harbour', note: 'Stahlblau — Marine, einen Schritt zurück' },
	{ name: 'Pergament', token: '--color-parchment', note: 'Cremegelb — die warme Fläche' },
	{ name: 'Sonnenblume', token: '--color-sunflower', note: 'warmes Bernstein-Tan' },
	{ name: 'Tuscan Sun', token: '--color-tuscan-sun', note: 'gebranntes Gold — liest sich als Text' },
	{ name: 'Terracotta', token: '--color-terracotta', note: 'gebranntes Orange' },
	{ name: 'Moos', token: '--color-moss', note: 'tiefes Grün' },
	{ name: 'Salbei', token: '--color-sage', note: 'blasses Grün — nur als Fläche' },
	{ name: 'Paradise Water', token: '--color-paradise-water', note: 'Türkis' },
	{ name: 'Iris', token: '--color-iris', note: 'Violett' },
	{ name: 'Driftwood', token: '--color-driftwood', note: 'Graublau' },
	{ name: 'Stein', token: '--color-stone', note: 'warmes Grau' }
]

/** Block 2: the cream ladder, lightest first. */
const SURFACES: Tone[] = [
	{ name: 'Seiten-Creme', token: '--color-surface-cream', note: 'der Grund, auf dem alles liegt' },
	{ name: 'Eierschale weich', token: '--color-surface-soft', note: 'Display-Flächen' },
	{ name: 'Karte', token: '--color-surface-card', note: 'Ruhezustand' },
	{ name: 'Karte hover', token: '--color-surface-card-hover', note: 'Zeiger darüber' },
	{ name: 'Karte gewählt', token: '--color-surface-card-selected', note: 'Auswahl-Highlight' },
	{ name: 'Tinte', token: '--color-ink', note: 'Fließtext — nie reines Schwarz' },
	{ name: 'Kreide', token: '--color-chalk', note: 'Text auf dunklem Ton' }
]

/** What the browser resolved, per token — the honest value. */
let resolved = $state<Record<string, string>>({})

$effect(() => {
	const style = getComputedStyle(document.documentElement)
	const next: Record<string, string> = {}
	const read = (token: string) => {
		next[token] = style.getPropertyValue(token).trim()
	}
	for (const r of ROLES) {
		read(r.token)
		read(r.toneToken)
	}
	for (const t of [...TONES, ...SURFACES]) read(t.token)
	resolved = next
})

/**
 * Two TONES resolving to the same value would mean one colour wearing two
 * names — the drift this consolidation set out to end. Roles are excluded:
 * several roles sharing a tone is the design, not a duplicate.
 */
const collisions = $derived.by(() => {
	const seen = new Map<string, string[]>()
	for (const t of TONES) {
		const value = resolved[t.token]
		if (!value) continue
		seen.set(value, [...(seen.get(value) ?? []), t.name])
	}
	return [...seen.entries()].filter(([, names]) => names.length > 1)
})
</script>

{#snippet swatch(item: Tone)}
	<li
		class="overflow-hidden rounded-xl border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
	>
		<!-- The colour gets the room: a full-width field, not a chip. -->
		<span
			class="block h-24 w-full border-foreground/10 border-b"
			style="background: var({item.token})"
		></span>
		<div class="px-3 py-2.5">
			<div class="flex items-baseline gap-2">
				<span class="font-medium text-xs">{item.name}</span>
				<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/45">
					{resolved[item.token] || '—'}
				</span>
			</div>
			<p class="truncate text-[0.625rem] text-foreground/40">{item.note}</p>
			<p class="truncate font-mono text-[0.5625rem] text-foreground/30">{item.token}</p>
		</div>
	</li>
{/snippet}

<div class="flex flex-col gap-8">
	<div>
		<h2 class="font-semibold text-sm">Brand-Farben</h2>
		<p class="pt-1 text-foreground/50 text-xs">
			Gelesen aus dem laufenden Theme — jede Fläche malt sich mit ihrem eigenen Token. Töne tragen
			die Farbe, Rollen tragen die Bedeutung; kein Bauteil nennt je einen Hex-Wert.
		</p>
	</div>

	<!-- ── Roles: the mapping, and the reason the rest exists ── -->
	<section class="flex flex-col gap-2">
		<div>
			<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				Rolle → Brand-Ton
			</h3>
			<p class="pt-0.5 text-[0.6875rem] text-foreground/40">
				Die Design-System-Rolle links, der Ton der sie trägt rechts. Eine Rolle hier umhängen färbt
				jede Fläche, die sie spricht.
			</p>
		</div>
		<ul class="grid gap-2 lg:grid-cols-2">
			{#each ROLES as r (r.role)}
				<li
					class="flex items-stretch gap-3 overflow-hidden rounded-xl border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					<span
						class="w-24 shrink-0 self-stretch border-foreground/10 border-r"
						style="background: var({r.token})"
					></span>
					<div class="min-w-0 flex-1 py-2.5 pr-3">
						<div class="flex items-baseline gap-2">
							<span class="font-mono font-medium text-xs">{r.role}</span>
							<span class="text-[0.625rem] text-foreground/30">→</span>
							<span class="truncate text-xs text-foreground/70">{r.tone}</span>
							<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/45">
								{resolved[r.token] || '—'}
							</span>
						</div>
						<p class="truncate text-[0.625rem] text-foreground/40">{r.note}</p>
						<p class="truncate font-mono text-[0.5625rem] text-foreground/30">{r.token}</p>
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<!-- ── Tones: the paint ── -->
	<section class="flex flex-col gap-2">
		<div>
			<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">Brand-Töne</h3>
			<p class="pt-0.5 text-[0.6875rem] text-foreground/40">
				Die zwölf Farben, die die Marke besitzt — jede genau einmal als Hex geschrieben, jede mit
				genau einem Namen.
			</p>
		</div>
		<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
			{#each TONES as t (t.token)}
				{@render swatch(t)}
			{/each}
		</ul>
	</section>

	<!-- ── Surfaces: the ground ── -->
	<section class="flex flex-col gap-2">
		<div>
			<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				Flächen & Tinte
			</h3>
			<p class="pt-0.5 text-[0.6875rem] text-foreground/40">
				Die Creme-Leiter, auf der die App liegt — hellste zuerst.
			</p>
		</div>
		<ul class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
			{#each SURFACES as s (s.token)}
				{@render swatch(s)}
			{/each}
		</ul>
	</section>

	{#if collisions.length > 0}
		<section class="flex flex-col gap-2">
			<div>
				<h3 class="font-semibold text-status-error-ink text-xs uppercase tracking-wide">
					Zwei Namen, eine Farbe
				</h3>
				<p class="pt-0.5 text-[0.6875rem] text-foreground/40">
					Sollte leer sein — ein Ton ist ein Name. Was hier auftaucht, gehört zusammengelegt.
				</p>
			</div>
			<ul class="flex flex-col gap-1.5">
				{#each collisions as [value, names] (value)}
					<li
						class="flex items-center gap-3 rounded-xl border border-foreground/5 bg-[#fffdf7] px-3 py-2"
					>
						<span
							class="size-6 shrink-0 rounded-md border border-foreground/10"
							style="background: {value}"
						></span>
						<span class="shrink-0 font-mono text-[0.625rem] text-foreground/45">{value}</span>
						<span class="min-w-0 flex-1 truncate text-[0.625rem] text-foreground/35">
							{names.join(' · ')}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
