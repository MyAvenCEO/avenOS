<script lang="ts">
import {
	alleLaeufe,
	eingaenge,
	type Intent,
	type IntentStatus,
	intentStatus,
	intents,
	type RunZustand
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

let ausgewaehlt = $state<Intent>(intents[0])

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
						onclick={() => {
							ausgewaehlt = i
						}}
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

		<div class="grid grid-cols-1 gap-4 2xl:grid-cols-2">
			{#each ausgewaehlt.runs as run (run.id)}
				<SkillRunCard {run} alle={ausgewaehlt.runs} />
			{/each}
		</div>
	</div>
</div>
