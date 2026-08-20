<script lang="ts">
import FlowStepper from './FlowStepper.svelte'
import ArchivFace from './faces/ArchivFace.svelte'
import BuchungFace from './faces/BuchungFace.svelte'
import MatchFace from './faces/MatchFace.svelte'
import TriageFace from './faces/TriageFace.svelte'
import type { FaceKey, SkillRun } from './mock-intents'

/**
 * Der geteilte RAHMEN eines Skill-Laufs: Kopf (Skill + Zweck + Zustand),
 * der gemeinsame Stepper, die Abhängigkeit — und erst DARUNTER das
 * eigene Gesicht des Skills. Abhängigkeiten sind Sache des Rahmens,
 * nicht der Gesichter: jede Karte kann warten, egal worauf.
 */
const { run, alle }: { run: SkillRun; alle: SkillRun[] } = $props()

const FACES: Record<FaceKey, typeof ArchivFace> = {
	archiv: ArchivFace,
	match: MatchFace,
	buchung: BuchungFace,
	triage: TriageFace
}
const Face = $derived(FACES[run.face])

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

	<div class="border-border/60 border-t pt-3">
		<Face {run} />
	</div>

	{#if run.zustand === 'wartet-mensch'}
		<p class="text-[0.625rem] text-foreground/40">
			Deine Entscheidung geht als Ereignis zurück in diesen Lauf — Attrappe: hier noch ohne Wirkung.
		</p>
	{/if}
</article>
