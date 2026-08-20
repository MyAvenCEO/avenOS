<script lang="ts">
import FlowStepper from './FlowStepper.svelte'
import BuchungFace from './faces/BuchungFace.svelte'
import MatchFace from './faces/MatchFace.svelte'
import TriageFace from './faces/TriageFace.svelte'
import type { FaceKey, SkillRun } from './mock-intents'
import SkillRunCard from './SkillRunCard.svelte'

/**
 * Der geteilte RAHMEN eines Skill-Laufs: Kopf (Name + Zweck + Zustand),
 * der gemeinsame Stepper, die Abhängigkeit — und darunter entweder das
 * eigene Gesicht des Skills ODER seine Kinder: ein Schritt, der selbst
 * ein Flow ist, wird als ganze Karte IM Rahmen gerendert — dieselbe
 * Komponente, rekursiv, beliebig tief. Genau die Komposition, die die
 * Rezept-Registry deklariert (subflow), nur eben sichtbar.
 *
 * Abhängigkeiten und Verschachtelung sind Sache des Rahmens, Fachliches
 * ist Sache der Gesichter. Eine Komposition hat deshalb oft KEIN
 * Gesicht — ihr Inhalt sind ihre Kinder.
 */
const { run, alle }: { run: SkillRun; alle: SkillRun[] } = $props()

const FACES: Record<FaceKey, typeof MatchFace> = {
	match: MatchFace,
	buchung: BuchungFace,
	triage: TriageFace
}
const Face = $derived(run.face ? FACES[run.face] : null)

const lieferant = $derived(alle.find((r) => r.id === run.braucht?.run))

const PILL: Record<SkillRun['zustand'], { label: string; klasse: string }> = {
	laeuft: { label: 'läuft', klasse: 'text-status-working' },
	'wartet-mensch': { label: 'wartet auf dich', klasse: 'text-primary' },
	'wartet-ergebnis': { label: 'wartet', klasse: 'text-foreground/40' },
	fertig: { label: 'fertig', klasse: 'text-status-success' }
}
</script>

<article
	class="flex flex-col gap-3 rounded-2xl border p-4 {run.zustand === 'wartet-mensch'
		? 'border-primary/40 bg-surface-cream/40'
		: run.zustand === 'wartet-ergebnis'
			? 'border-border border-dashed bg-surface-card/40'
			: 'border-border bg-surface-card'}"
>
	<header class="flex flex-wrap items-baseline gap-2">
		<h4 class="font-semibold text-sm">{run.skill}</h4>
		<span class="text-foreground/45 text-xs">{run.zweck}</span>
		<span class="ml-auto font-mono text-[0.625rem] {PILL[run.zustand].klasse}">
			{PILL[run.zustand].label}
		</span>
	</header>

	<FlowStepper schritte={run.schritte} />

	{#if run.braucht && run.zustand === 'wartet-ergebnis'}
		<p class="font-mono text-[0.625rem] text-status-working">
			◇ wartet auf „{run.braucht.was}" aus {lieferant?.skill ?? run.braucht.run} — läuft von allein
			weiter, sobald es vorliegt.
		</p>
	{:else if run.braucht}
		<p class="font-mono text-[0.625rem] text-foreground/35">
			nutzte „{run.braucht.was}" aus {lieferant?.skill ?? run.braucht.run}
		</p>
	{/if}

	{#if Face}
		<div class="border-border/60 border-t pt-3">
			<Face {run} />
		</div>
	{/if}

	{#if run.unter?.length}
		<!-- Die Rekursion: jedes Kind ist dieselbe Karte, eine Ebene tiefer.
		     Der Einzug + die Fußnote sagen, WELCHER Schritt hier aufgeht. -->
		<div class="flex flex-col gap-3 border-border/70 border-l-2 pl-3">
			{#each run.unter as u (u.id)}
				<div class="flex flex-col gap-1">
					<p class="font-mono text-[0.5625rem] text-foreground/35">
						└ Schritt „{u.alsSchritt}" ist selbst ein Flow
					</p>
					<SkillRunCard run={u} alle={run.unter ?? []} />
				</div>
			{/each}
		</div>
	{/if}

	{#if run.zustand === 'wartet-mensch' && Face}
		<p class="text-[0.625rem] text-foreground/40">
			Deine Entscheidung geht als Ereignis zurück in diesen Lauf — Attrappe: hier noch ohne Wirkung.
		</p>
	{/if}
</article>
