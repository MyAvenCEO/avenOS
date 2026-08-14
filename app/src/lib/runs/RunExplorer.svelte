<script lang="ts">
import { type RecipeNodeConfig, recipes } from '../fibu/recipe-config'
import { type FlowRun, runs } from './mock-runs'
import StepFace from './StepFace.svelte'
import type { Halt } from './step-faces'

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
 * Der Weg steht als Stepper in der rechten Aside, von oben nach unten —
 * dieselbe Grammatik wie die Lens-Aside des Actor-Explorers: eine schmale
 * Spalte, die bestimmt, WAS in der Mitte steht. Jeder Halt ist anklickbar
 * und zeigt in der Mitte seine eigene Detailfläche — erledigte Schritte zeigen, was dort geschah, der
 * aktuelle zeigt den Zustand, kommende zeigen, was bevorsteht. Ohne
 * Zutun steht die Auswahl auf dem aktuellen Schritt; ein Wechsel des
 * Laufs setzt sie dorthin zurück.
 *
 * Deshalb ist die Detailseite kein Switch über Klassen wie "Idee, Todo,
 * Unbekanntes", sondern über die KNOTENART plus den Zustand des Schritts:
 * ein Gate wartet, ein Sink hat angenommen, eine Transformation läuft,
 * eine Skill-Grenze hat übergeben. Ein neuer Flow braucht dafür nichts —
 * der Buchhaltungs-Lauf unten in der Liste ist der Beleg.
 */

let selected = $state<FlowRun>(runs[0])
/** Angeklickter Halt; null heißt "der aktuelle" — die Vorgabe. */
let stepId = $state<string | null>(null)

const recipeOf = (id: string) => recipes.find((r) => r.id === id)
const recipe = $derived(recipeOf(selected.flow))
const nodeOf = (id: string): RecipeNodeConfig | undefined => recipe?.nodes.find((n) => n.id === id)

type StepState = Halt['state']
/** Ein Halt plus seine Knoten-Id — genau das, was das Gesicht braucht. */
type Stufe = Halt & { node: string }

/** Der Weg als Kette: Erledigtes, die Position, das Bevorstehende. */
const stufen = $derived<Stufe[]>([
	...selected.weg.map((s) => ({
		node: s.node,
		state: 'done' as const,
		um: s.um,
		ergebnis: s.ergebnis,
		guete: s.guete
	})),
	{ node: selected.bei, state: 'current' as const },
	...(recipe?.edges ?? [])
		.filter((e) => e.from === selected.bei)
		.map((e) => ({ node: e.to, state: 'pending' as const, port: e.fromPort }))
])

/** Ohne Klick steht die Auswahl auf dem aktuellen Schritt. */
const aktiv = $derived(
	stufen.find((s) => s.node === stepId && stepId !== null) ??
		stufen.find((s) => s.state === 'current') ??
		stufen[0]
)
const knoten = $derived(nodeOf(aktiv?.node ?? ''))

/**
 * Wohin die Ausgänge des gezeigten Schritts führen — aus den Kanten, mit
 * dem Namen des Zielknotens. Ein Rezept muss seine Zweige nicht
 * beschriften; dann beschriftet sie ihr Ziel.
 */
const ziele = $derived(
	Object.fromEntries(
		(recipe?.edges ?? [])
			.filter((e) => e.from === aktiv?.node && e.fromPort)
			.map((e) => [e.fromPort, nodeOf(e.to)?.name ?? e.to])
	)
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

const MARK: Record<StepState, string> = { done: '✓', current: '◐', pending: '○' }

const zeit = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

function waehle(run: FlowRun) {
	selected = run
	// Ein neuer Lauf beginnt immer bei seinem aktuellen Schritt.
	stepId = null
}
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
					onclick={() => waehle(r)}
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
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-border border-y bg-surface-card/30 p-5"
	>
		<header class="flex flex-wrap items-baseline gap-3">
			<h2 class="font-display font-semibold text-lg">{selected.titel}</h2>
			<span class="text-foreground/50 text-xs">
				{recipe?.name ?? selected.flow}
				· {zeit.format(new Date(selected.erfasst))}
			</span>
			<span class="ml-auto font-mono text-xs {STATUS[selected.status].klasse}">
				{STATUS[selected.status].label}
			</span>
		</header>

		<!-- NUR das Gesicht. Knotenart, transform.type, Beschreibung,
		     Autonomie und der Gegenstand waren Innereien des Rezepts — ein
		     Mensch will sehen, was passiert, nicht wie es verdrahtet ist. Die
		     Technik kommt später als eigener Reiter zurück, nicht hier. -->
		<section
			class="rounded-2xl border p-5 {aktiv?.state === 'pending'
				? 'border-border border-dashed bg-surface-card/40'
				: 'border-border bg-surface-card'}"
		>
			{#if knoten && aktiv}
				{#key `${selected.id}:${aktiv.node}`}
					<StepFace node={knoten} halt={aktiv} run={selected} {ziele} />
				{/key}
			{/if}
		</section>
	</div>

	<!-- Der Weg als Stepper: oben nach unten, rechts — schmal, immer
	     sichtbar, und zugleich die Navigation über den Lauf. Namen,
	     Reihenfolge und das Bevorstehende kommen aus dem Rezept. -->
	<nav
		class="flex w-56 shrink-0 flex-col overflow-y-auto rounded-r-2xl border border-border border-l-0 bg-surface-card/50 py-3"
	>
		<p class="px-4 pb-2 text-[0.625rem] text-foreground/35 uppercase tracking-[0.2em]">Weg</p>
		{#each stufen as s, i (s.node + i)}
			<button
				type="button"
				onclick={() => {
					stepId = s.node
				}}
				title={nodeOf(s.node)?.description}
				class="mx-2 flex items-baseline gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors {aktiv?.node ===
				s.node
					? 'border border-foreground/5 bg-[#fffdf7] shadow-[0_1px_3px_rgba(30,41,59,0.05)]'
					: 'hover:bg-surface-card'}"
			>
				<span
					class="w-3 shrink-0 text-center font-mono {s.state === 'done'
						? 'text-status-success'
						: s.state === 'current'
							? 'text-primary'
							: 'text-foreground/30'}"
				>
					{MARK[s.state]}
				</span>
				<span class="min-w-0 flex-1">
					<span
						class="block leading-snug {s.state === 'pending'
							? 'text-foreground/45'
							: 'font-medium'}"
					>
						{nodeOf(s.node)?.name ?? s.node}
					</span>
					<span class="block pt-0.5 font-mono text-[0.625rem] text-foreground/35">
						{s.um ?? (s.state === 'pending' ? `über „${s.port}"` : 'jetzt')}
					</span>
				</span>
			</button>
		{/each}
	</nav>
</div>
