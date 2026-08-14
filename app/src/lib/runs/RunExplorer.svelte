<script lang="ts">
import { type RecipeNodeConfig, recipes } from '../fibu/recipe-config'
import { type FlowRun, runs } from './mock-runs'

/**
 * Der Prozess-Betrachter: EIN Viewer für die Läufe ALLER Flows.
 *
 * Die Skills-Ansicht zeigt Definitionen, diese hier zeigt Instanzen — und
 * zwar ohne eine einzige flow-spezifische Zeile. Der Lauf trägt nur vier
 * Angaben (wo er steht, wie er kam, was mitläuft, wie er heißt); alles
 * Sichtbare darüber hinaus liest die Ansicht aus dem REZEPT: die
 * Schrittnamen, die Art des Schritts, die möglichen Aktionen eines Gates,
 * das Ziel eines Sinks, die nächsten Schritte aus den Kanten.
 *
 * Deshalb ist die Detailseite kein Switch über Klassen wie "Idee, Todo,
 * Unbekanntes", sondern über die KNOTENART, an der der Lauf gerade steht:
 * ein Gate wartet, ein Sink hat angenommen, eine Transformation läuft,
 * eine Skill-Grenze hat übergeben. Ein neuer Flow braucht dafür nichts —
 * der Buchhaltungs-Lauf unten in der Liste ist der Beleg.
 */

let selected = $state<FlowRun>(runs[0])

const recipeOf = (id: string) => recipes.find((r) => r.id === id)
const recipe = $derived(recipeOf(selected.flow))
const nodeOf = (id: string): RecipeNodeConfig | undefined => recipe?.nodes.find((n) => n.id === id)

/** Der Schritt, an dem der Lauf steht — die Detailseite hängt an seiner Art. */
const hier = $derived(nodeOf(selected.bei))

/** Was als Nächstes käme: die Ziele der ausgehenden Kanten. */
const naechste = $derived(
	(recipe?.edges ?? [])
		.filter((e) => e.from === selected.bei)
		.map((e) => ({ node: nodeOf(e.to), port: e.fromPort }))
		.filter((x) => x.node !== undefined)
)

/** Gates deklarieren ihre Aktionen im Rezept — die Ansicht erfindet keine. */
const aktionen = $derived(
	Array.isArray(hier?.transform.config.aktionen)
		? (hier?.transform.config.aktionen as string[])
		: []
)

/** Läufe nach Flow gruppiert: die Aside zeigt, dass es mehrere sind. */
const gruppen = $derived(
	[...new Set(runs.map((r) => r.flow))].map((flow) => ({
		flow,
		name: recipeOf(flow)?.name ?? flow,
		items: runs.filter((r) => r.flow === flow)
	}))
)

const STATUS: Record<FlowRun['status'], { label: string; klasse: string }> = {
	laeuft: { label: 'läuft', klasse: 'text-status-working' },
	wartet: { label: 'wartet', klasse: 'text-primary' },
	fertig: { label: 'fertig', klasse: 'text-status-success' }
}

const KIND_LABEL: Record<string, string> = {
	input: 'Eingang',
	transform: 'Transformation',
	route: 'Weiche',
	hitl: 'Menschliches Gate',
	subflow: 'Unterflow',
	handoff: 'Skill-Grenze',
	output: 'Ausgang'
}

const zeit = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })
</script>

<div class="flex min-h-0 flex-1">
	<!-- Die Läufe, nach Flow gruppiert — dieselbe Aside-Grammatik wie in der
	     FiBu: flache Zeilen, Trennlinien, der ausgewählte getönt. -->
	<nav
		class="flex w-80 shrink-0 flex-col overflow-y-auto rounded-l-2xl border border-border bg-surface-card/50"
	>
		{#each gruppen as g (g.flow)}
			<h3
				class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
			>
				{g.name}
				<span class="font-normal opacity-60">· {g.items.length}</span>
			</h3>
			{#each g.items as r (r.id)}
				<button
					type="button"
					onclick={() => {
						selected = r
					}}
					class="border-border/50 border-b px-4 py-3 text-left transition-colors {selected.id === r.id
						? 'bg-surface-cream'
						: 'hover:bg-surface-card'}"
				>
					<div class="flex items-baseline justify-between gap-2">
						<span class="truncate font-semibold text-sm">{r.titel}</span>
						<span class="shrink-0 font-mono text-[0.625rem] {STATUS[r.status].klasse}">
							{STATUS[r.status].label}
						</span>
					</div>
					<div class="truncate pt-1 text-foreground/50 text-xs">{r.kurz}</div>
				</button>
			{/each}
		{/each}
	</nav>

	<div
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-r-2xl border border-border border-l-0 bg-surface-card/30 p-5"
	>
		<header class="flex flex-wrap items-baseline gap-3">
			<h2 class="font-display font-semibold text-lg">{selected.titel}</h2>
			<span class="font-mono text-foreground/40 text-xs">{selected.id}</span>
			<span class="text-foreground/50 text-xs">
				{recipe?.name ?? selected.flow}
				· {zeit.format(new Date(selected.erfasst))}
			</span>
			<span class="ml-auto font-mono text-xs {STATUS[selected.status].klasse}">
				{STATUS[selected.status].label}
			</span>
		</header>

		<!-- Der Weg: zurückgelegte Schritte, die aktuelle Position, das was
		     folgen könnte. Namen und Reihenfolge kommen aus dem Rezept. -->
		<section class="rounded-2xl border border-border bg-surface-card p-4">
			<h3 class="pb-3 font-semibold text-foreground/50 text-xs uppercase tracking-wide">Weg</h3>
			<ol class="flex flex-col gap-2">
				{#each selected.weg as schritt, i (i)}
					{@const n = nodeOf(schritt.node)}
					<li class="flex items-baseline gap-3 text-sm">
						<span class="w-4 shrink-0 text-center font-mono text-status-success">✓</span>
						<span class="w-44 shrink-0 truncate">{n?.name ?? schritt.node}</span>
						<span class="w-12 shrink-0 font-mono text-foreground/40 text-xs">{schritt.um}</span>
						<span class="min-w-0 flex-1 truncate text-foreground/60 text-xs">
							{schritt.ergebnis ?? ''}
						</span>
					</li>
				{/each}
				<li class="flex items-baseline gap-3 text-sm">
					<span class="w-4 shrink-0 text-center font-mono text-primary">◐</span>
					<span class="w-44 shrink-0 truncate font-semibold">{hier?.name ?? selected.bei}</span>
					<span class="w-12 shrink-0"></span>
					<span class="min-w-0 flex-1 truncate text-foreground/50 text-xs">
						{KIND_LABEL[hier?.kind ?? ''] ?? hier?.kind}
						· {hier?.transform.type}
					</span>
				</li>
				{#each naechste as n, i (i)}
					<li class="flex items-baseline gap-3 text-foreground/40 text-sm">
						<span class="w-4 shrink-0 text-center font-mono">○</span>
						<span class="w-44 shrink-0 truncate">{n.node?.name}</span>
						<span class="w-12 shrink-0"></span>
						<span class="min-w-0 flex-1 truncate text-xs">über Port „{n.port}"</span>
					</li>
				{/each}
			</ol>
		</section>

		<!-- Was durch den Flow läuft: frei geformte Felder, roh gezeigt. -->
		<section class="rounded-2xl border border-border bg-surface-card p-4">
			<h3 class="pb-3 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				Gegenstand
			</h3>
			<dl class="flex flex-col gap-2">
				{#each Object.entries(selected.gegenstand) as [feld, wert] (feld)}
					<div class="flex gap-3 text-sm">
						<dt class="w-24 shrink-0 font-mono text-foreground/40 text-xs">{feld}</dt>
						<dd class="min-w-0 flex-1 leading-relaxed">{wert}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<!-- Die Platzhalter-Fläche: nicht nach Klasse, sondern nach der ART des
		     Schritts, an dem der Lauf steht. Das ist der ganze Trick. -->
		<section
			class="rounded-2xl border border-dashed p-4 {hier?.kind === 'hitl'
				? 'border-primary/40 bg-surface-cream/40'
				: 'border-border'}"
		>
			<h3 class="pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
				{KIND_LABEL[hier?.kind ?? ''] ?? 'Schritt'}
				· {hier?.name}
			</h3>

			{#if hier?.kind === 'hitl'}
				<p class="text-sm">{hier.description}</p>
				<div class="flex flex-wrap gap-2 pt-3">
					{#each aktionen as a (a)}
						<span class="rounded-full border border-border bg-surface-card px-3 py-1 text-xs">
							{a}
						</span>
					{/each}
				</div>
				<p class="pt-3 text-foreground/40 text-xs">
					Platzhalter: die Aktionen stehen so im Rezept — ausgeführt wird hier noch nichts.
				</p>
			{:else if hier?.kind === 'output'}
				<p class="text-sm">{hier.description}</p>
				<p class="pt-3 font-mono text-foreground/50 text-xs">
					{hier.transform.type}
					· {JSON.stringify(hier.transform.config)}
				</p>
				<p class="pt-2 text-foreground/40 text-xs">
					Platzhalter: hier käme die Zielansicht — die Liste, das Protokoll, die Datei.
				</p>
			{:else if hier?.kind === 'handoff'}
				<p class="text-sm">{hier.description}</p>
				<p class="pt-3 text-foreground/50 text-xs">
					Übergeben an Skill <span class="font-mono">{hier.handoff?.skill}</span> — der Lauf endet
					hier und wird dort zu einem neuen.
				</p>
			{:else}
				<p class="text-sm">{hier?.description}</p>
				<p class="pt-3 text-foreground/40 text-xs">
					Platzhalter: läuft gerade — hier käme der Live-Zustand des Schritts.
				</p>
			{/if}
		</section>
	</div>
</div>
