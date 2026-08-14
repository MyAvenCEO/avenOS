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
 * Der Weg ist ein Stepper von links nach rechts und zugleich die
 * Navigation: jeder Halt ist anklickbar und zeigt darunter seine eigene
 * Detailfläche — erledigte Schritte zeigen, was dort geschah, der
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

type StepState = 'done' | 'current' | 'pending'
interface Stufe {
	node: string
	state: StepState
	um?: string
	ergebnis?: string
	port?: string
}

/** Der Weg als Kette: Erledigtes, die Position, das Bevorstehende. */
const stufen = $derived<Stufe[]>([
	...selected.weg.map((s) => ({
		node: s.node,
		state: 'done' as const,
		um: s.um,
		ergebnis: s.ergebnis
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

/** Gates deklarieren ihre Aktionen im Rezept — die Ansicht erfindet keine. */
const aktionen = $derived(
	Array.isArray(knoten?.transform.config.aktionen)
		? (knoten?.transform.config.aktionen as string[])
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

const MARK: Record<StepState, string> = { done: '✓', current: '◐', pending: '○' }

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

		<!-- Der Weg als Stepper: von links nach rechts, jeder Halt anklickbar.
		     Namen, Reihenfolge und das Bevorstehende kommen aus dem Rezept. -->
		<nav class="flex items-center gap-1 overflow-x-auto pb-1">
			{#each stufen as s, i (s.node + i)}
				{#if i > 0}
					<span class="shrink-0 text-foreground/20">—</span>
				{/if}
				<button
					type="button"
					onclick={() => {
						stepId = s.node
					}}
					title={nodeOf(s.node)?.description}
					class="flex shrink-0 items-baseline gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors
						{aktiv?.node === s.node
						? 'border-primary bg-primary text-primary-foreground'
						: s.state === 'pending'
							? 'border-border/60 border-dashed text-foreground/40 hover:border-foreground/30'
							: 'border-border bg-surface-card hover:border-foreground/30'}"
				>
					<span
						class="font-mono {aktiv?.node === s.node
							? ''
							: s.state === 'done'
								? 'text-status-success'
								: s.state === 'current'
									? 'text-primary'
									: ''}"
					>
						{MARK[s.state]}
					</span>
					<span class="max-w-40 truncate font-medium">{nodeOf(s.node)?.name ?? s.node}</span>
					{#if s.um}
						<span class="font-mono opacity-50">{s.um}</span>
					{/if}
				</button>
			{/each}
		</nav>

		<!-- Die Detailfläche des GEWÄHLTEN Halts: was dort geschah, geschieht
		     oder geschehen wird — verzweigt über Zustand und Knotenart, nie
		     über die Sorte des Gegenstands. -->
		<section
			class="rounded-2xl border p-4 {aktiv?.state === 'current' && knoten?.kind === 'hitl'
				? 'border-primary/40 bg-surface-cream/40'
				: aktiv?.state === 'pending'
					? 'border-border border-dashed'
					: 'border-border bg-surface-card'}"
		>
			<div class="flex flex-wrap items-baseline gap-2 pb-2">
				<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
					{KIND_LABEL[knoten?.kind ?? ''] ?? 'Schritt'}
					· {knoten?.name ?? aktiv?.node}
				</h3>
				<span class="font-mono text-[0.625rem] text-foreground/35">{knoten?.transform.type}</span>
				<span
					class="ml-auto font-mono text-[0.625rem] {aktiv?.state === 'done'
						? 'text-status-success'
						: aktiv?.state === 'current'
							? 'text-primary'
							: 'text-foreground/35'}"
				>
					{aktiv?.state === 'done'
						? `abgeschlossen ${aktiv.um ?? ''}`
						: aktiv?.state === 'current'
							? 'hier steht der Lauf'
							: `steht bevor · über Port „${aktiv?.port}"`}
				</span>
			</div>

			<p class="text-sm leading-relaxed">{knoten?.description}</p>

			{#if aktiv?.state === 'done'}
				{#if aktiv.ergebnis}
					<p class="pt-3 text-sm">
						<span class="pr-2 font-mono text-foreground/40 text-xs">Ergebnis</span>
						{aktiv.ergebnis}
					</p>
				{:else}
					<p class="pt-3 text-foreground/40 text-xs">Ohne eigenes Ergebnis durchlaufen.</p>
				{/if}
			{:else if aktiv?.state === 'pending'}
				<p class="pt-3 text-foreground/40 text-xs">
					Platzhalter: noch nicht erreicht — hier käme, was dieser Schritt tun wird.
				</p>
			{:else if knoten?.kind === 'hitl'}
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
			{:else if knoten?.kind === 'output'}
				<p class="pt-3 font-mono text-foreground/50 text-xs">
					{JSON.stringify(knoten.transform.config)}
				</p>
				<p class="pt-2 text-foreground/40 text-xs">
					Platzhalter: hier käme die Zielansicht — die Liste, das Protokoll, die Datei.
				</p>
			{:else if knoten?.kind === 'handoff'}
				<p class="pt-3 text-foreground/50 text-xs">
					Übergeben an Skill <span class="font-mono">{knoten.handoff?.skill}</span> — der Lauf endet
					hier und wird dort zu einem neuen.
				</p>
			{:else}
				<p class="pt-3 text-foreground/40 text-xs">
					Platzhalter: läuft gerade — hier käme der Live-Zustand des Schritts.
				</p>
			{/if}
		</section>

		<!-- Was durch den Flow läuft: gilt für den ganzen Lauf, nicht für
		     einen Halt — deshalb unter der Schritt-Fläche. -->
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
	</div>
</div>
