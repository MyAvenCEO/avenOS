<script lang="ts">
import { type RecipeNodeConfig, recipes } from '../fibu/recipe-config'
import { type FlowRun, runs } from './mock-runs'
import StepFace from './StepFace.svelte'

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
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-border border-y bg-surface-card/30 p-5"
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

		<!-- ZUERST das Gesicht: was an dieser Stelle konkret passiert, gezeigt
		     statt beschrieben — ein ViewDef, gerendert von derselben aven-ui-
		     Engine wie die Actor-Faces. -->
		{#if knoten}
			{#key `${selected.id}:${aktiv?.node}`}
				<StepFace
					node={knoten}
					zustand={aktiv?.state ?? 'current'}
					ergebnis={aktiv?.ergebnis}
					run={selected}
				/>
			{/key}
		{/if}

		<!-- Danach die Einordnung des Halts: was er ist, wo er steht — die
		     Metadaten zum Bild darüber. Was der Schritt TUT, steht im
		     Gesicht; hier steht nur, was er IST. -->
		<section
			class="rounded-2xl border p-4 {aktiv?.state === 'pending'
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

			{#if aktiv?.state === 'done' && aktiv.ergebnis}
				<p class="pt-3 text-sm">
					<span class="pr-2 font-mono text-foreground/40 text-xs">Ergebnis</span>
					{aktiv.ergebnis}
				</p>
			{/if}

			<!-- Die Autonomie ist die einzige Angabe, die weder im Gesicht noch
			     im Stepper vorkommt — und die wichtigste für den Menschen:
			     ohne Block ist der Schritt beaufsichtigt. -->
			<p class="pt-3 font-mono text-[0.625rem] text-foreground/35">
				{knoten?.autonomie
					? `${knoten.autonomie.modus} · Fehler → ${knoten.autonomie.fehler}${knoten.autonomie.freigabe ? ` · freigegeben von ${knoten.autonomie.freigabe.durch}` : ''}`
					: 'beaufsichtigt · keine Autonomie im Rezept'}
			</p>
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
