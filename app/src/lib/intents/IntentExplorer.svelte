<script lang="ts">
import {
	alleLaeufe,
	eingaenge,
	gespeist,
	type Intent,
	type IntentStatus,
	intentStatus,
	intents,
	type RunZustand,
	spur
} from './mock-intents'
import SkillRunCard from './SkillRunCard.svelte'

/**
 * Das Intent-Cockpit: die tägliche Arbeitsfläche zwischen Mensch und
 * Skill-Mesh.
 *
 * Links der EINGANG (ungeroutete Ereignisse — jedes wird ein neuer
 * Intent oder heftet sich an einen bestehenden) und die Intents nach
 * abgeleitetem Status. In der Mitte der ausgewählte Intent: sein Ziel
 * als Satz, darunter seine Skill-Läufe als Karten — parallel, wo nichts
 * dazwischen liegt, wartend, wo einer das Ergebnis des anderen braucht.
 *
 * Der Rahmen jeder Karte ist überall derselbe (Stepper, Abhängigkeit,
 * Zustand); nur das Gesicht darunter gehört dem Skill. Deshalb liest
 * sich eine Rechnung genauso wie eine Sprachnotiz — und genau das ist
 * der Anspruch: EIN Cockpit für alle Arbeit, nicht eins pro Domäne.
 */

/**
 * Die Lande-Ansicht ist der Sammel-Intent (der Monat): er IST die
 * Übersicht über alles, was gerade läuft — die Einzel-Intents erreicht
 * man von dort mit einem Klick über sein Brett.
 */
let ausgewaehlt = $state<Intent>(intents.find((i) => gespeist(i).length > 0) ?? intents[0])

const GRUPPEN: { status: IntentStatus; label: string }[] = [
	{ status: 'braucht-dich', label: 'Braucht dich' },
	{ status: 'laeuft', label: 'Läuft' },
	{ status: 'fertig', label: 'Fertig' }
]

const STATUS: Record<IntentStatus, { label: string; klasse: string }> = {
	'braucht-dich': { label: 'wartet auf dich', klasse: 'text-primary' },
	laeuft: { label: 'läuft', klasse: 'text-status-working' },
	fertig: { label: 'fertig', klasse: 'text-status-success' }
}

/** Mini-Glyphen in der Liste: ein Zeichen pro Skill-Lauf. */
/** Status-Glyphen für Intent-Zeilen auf dem Brett. */
const STATUS_GLYPH: Record<IntentStatus, { mark: string; klasse: string }> = {
	fertig: { mark: '✓', klasse: 'text-status-success' },
	'braucht-dich': { mark: '●', klasse: 'text-primary' },
	laeuft: { mark: '◐', klasse: 'text-status-working' }
}

function waehle(intent: Intent) {
	ausgewaehlt = intent
}

const GLYPH: Record<RunZustand, { mark: string; klasse: string }> = {
	fertig: { mark: '●', klasse: 'text-status-success' },
	'wartet-mensch': { mark: '●', klasse: 'text-primary' },
	laeuft: { mark: '◐', klasse: 'text-status-working' },
	'wartet-ergebnis': { mark: '○', klasse: 'text-foreground/30' }
}

/** Die Zusammenfassung ist abgeleitet — generisch für jeden Intent. */
const bilanz = $derived.by(() => {
	const n = (z: RunZustand) => ausgewaehlt.runs.filter((r) => r.zustand === z).length
	const teile = [`${ausgewaehlt.runs.length} ${ausgewaehlt.runs.length === 1 ? 'Skill' : 'Skills'}`]
	if (n('fertig')) teile.push(`${n('fertig')} fertig`)
	if (n('laeuft')) teile.push(`${n('laeuft')} läuft`)
	if (n('wartet-mensch')) teile.push(`${n('wartet-mensch')} wartet auf dich`)
	if (n('wartet-ergebnis')) teile.push(`${n('wartet-ergebnis')} wartet auf Ergebnisse`)
	// Die Rekursion zählt mit: komponierte Skills bringen eigene Läufe.
	const gesamt = alleLaeufe(ausgewaehlt).length
	if (gesamt > ausgewaehlt.runs.length) teile.push(`${gesamt} Läufe insgesamt`)
	return teile.join(' · ')
})

const zielIntent = (id: string) => intents.find((i) => i.id === id)

/**
 * Das BRETT eines Sammel-Intents: die gespeisten Intents als Zeilen,
 * nach Status gruppiert, jede mit dem Grund, warum sie noch offen ist —
 * abgeleitet aus ihren Läufen (der wartende Skill + das Blatt seiner
 * Spur), nicht gepflegt. Klick = hinspringen.
 */
const brett = $derived.by(() => {
	const eintraege = gespeist(ausgewaehlt)
		.map(zielIntent)
		.filter((i) => i !== undefined)
		.map((i) => {
			const status = intentStatus(i)
			const traeger =
				i.runs.find((r) => r.zustand === 'wartet-mensch') ??
				i.runs.find((r) => r.zustand === 'laeuft')
			const blatt = traeger ? spur(traeger).pfad.at(-1) : undefined
			return {
				intent: i,
				status,
				grund:
					status === 'fertig'
						? 'abgeschlossen'
						: traeger
							? `${traeger.skill} · ${blatt ?? traeger.zweck}`
							: 'wartet auf Ergebnisse'
			}
		})
	return GRUPPEN.map((g) => ({
		...g,
		items: eintraege.filter((e) => e.status === g.status)
	})).filter((g) => g.items.length > 0)
})
const brettFertig = $derived(
	brett.flatMap((g) => g.items).filter((e) => e.status === 'fertig').length
)
const brettGesamt = $derived(brett.flatMap((g) => g.items).length)
const brettWas = $derived(
	ausgewaehlt.runs.find((r) => r.braucht?.intents)?.braucht?.was ?? 'alle Vorgänge'
)
</script>

<div class="flex min-h-0 flex-1">
	<nav
		class="flex w-80 shrink-0 flex-col overflow-y-auto rounded-l-2xl border border-border bg-surface-card/50"
	>
		<!-- Der Eingang: hier wird sichtbar, dass ALLES ein Ereignis ist,
		     das auf einen Intent geroutet wird — neu oder bestehend. -->
		<h3
			class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Eingang <span class="font-normal opacity-60">· zu routen</span>
		</h3>
		{#each eingaenge as e (e.id)}
			<div class="flex flex-col gap-2 border-border/50 border-b bg-surface-cream/30 px-4 py-3">
				<p class="text-xs leading-relaxed">{e.text}</p>
				{#if e.vorschlag}
					<p class="text-[0.625rem] text-foreground/45 leading-relaxed">
						Vorschlag: an „{zielIntent(e.vorschlag.intent)?.titel}" — {e.vorschlag.grund}
					</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-full bg-primary px-3 py-1 font-medium text-[0.6875rem] text-primary-foreground"
					>
						→ anheften
					</button>
					<button
						type="button"
						class="rounded-full border border-border px-3 py-1 text-[0.6875rem] text-foreground/60"
					>
						als neuer Intent
					</button>
				</div>
				<p class="font-mono text-[0.5625rem] text-foreground/30">{e.um} · Attrappe</p>
			</div>
		{/each}

		{#each GRUPPEN as g (g.status)}
			{@const items = intents.filter((i) => intentStatus(i) === g.status)}
			{#if items.length}
				<h3
					class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
				>
					{g.label} <span class="font-normal opacity-60">· {items.length}</span>
				</h3>
				{#each items as i (i.id)}
					<button
						type="button"
						onclick={() => waehle(i)}
						class="border-border/50 border-b px-4 py-3 text-left transition-colors {ausgewaehlt.id ===
						i.id
							? 'bg-surface-cream'
							: 'hover:bg-surface-card'}"
					>
						<div class="flex items-baseline justify-between gap-2">
							<span class="truncate font-semibold text-sm">{i.titel}</span>
							<span class="flex shrink-0 gap-0.5 font-mono text-[0.5625rem]">
								{#each i.runs as r (r.id)}
									<span class={GLYPH[r.zustand].klasse}>{GLYPH[r.zustand].mark}</span>
								{/each}
							</span>
						</div>
						<div class="truncate pt-1 text-foreground/50 text-xs">{i.ziel}</div>
					</button>
				{/each}
			{/if}
		{/each}
	</nav>

	<div
		class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-r-2xl border border-border border-l-0 bg-surface-card/30 p-5"
	>
		<header class="flex flex-col gap-1">
			<div class="flex flex-wrap items-baseline gap-3">
				<h2 class="font-display font-semibold text-lg">{ausgewaehlt.titel}</h2>
				<span class="ml-auto font-mono text-xs {STATUS[intentStatus(ausgewaehlt)].klasse}">
					{STATUS[intentStatus(ausgewaehlt)].label}
				</span>
			</div>
			<p class="text-foreground/70 text-sm">{ausgewaehlt.ziel}</p>
			<p class="text-[0.6875rem] text-foreground/40">
				{ausgewaehlt.quelle}
				· {ausgewaehlt.erfasst} · {bilanz}
			</p>
		</header>

		{#if brettGesamt > 0}
			<!-- Das Monatsbrett: die Haupt-Übersicht eines Sammel-Intents.
			     Nicht die Export-Karte ist hier die Nachricht, sondern der
			     Stand der Vorgänge, aus denen der Abschluss entsteht. -->
			<section class="rounded-2xl border border-border bg-surface-card p-4">
				<div class="flex flex-wrap items-baseline gap-3 pb-2">
					<h3 class="font-semibold text-foreground/50 text-xs uppercase tracking-wide">
						Vorgänge des Monats
					</h3>
					<span class="text-foreground/45 text-xs">wartet auf „{brettWas}"</span>
					<span class="ml-auto font-mono text-foreground/50 text-xs">
						{brettFertig}
						/ {brettGesamt}
					</span>
				</div>
				<div class="mb-3 h-1 overflow-hidden rounded-full bg-border/50">
					<div
						class="h-full rounded-full bg-status-success transition-all"
						style="width: {brettGesamt ? Math.round((brettFertig / brettGesamt) * 100) : 0}%"
					></div>
				</div>

				{#each brett as g (g.status)}
					<p
						class="pt-2 pb-1 font-mono text-[0.5625rem] text-foreground/35 uppercase tracking-[0.15em]"
					>
						{g.label}
						· {g.items.length}
					</p>
					{#each g.items as e (e.intent.id)}
						<button
							type="button"
							onclick={() => waehle(e.intent)}
							class="flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-cream/60"
						>
							<span
								class="w-3 shrink-0 text-center font-mono text-[0.625rem] {STATUS_GLYPH[e.status].klasse}"
							>
								{STATUS_GLYPH[e.status].mark}
							</span>
							<span
								class="min-w-0 flex-1 truncate text-sm {e.status === 'fertig' ? 'text-foreground/45' : 'font-medium'}"
							>
								{e.intent.titel}
							</span>
							<span class="max-w-[45%] truncate font-mono text-[0.625rem] text-foreground/40">
								{e.grund}
							</span>
						</button>
					{/each}
				{/each}
			</section>
		{/if}

		<div class="grid grid-cols-1 gap-4 2xl:grid-cols-2">
			{#each ausgewaehlt.runs as run (run.id)}
				<SkillRunCard {run} alle={ausgewaehlt.runs} />
			{/each}
		</div>
	</div>
</div>
