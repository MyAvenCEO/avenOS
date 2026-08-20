<script lang="ts">
import { type IntentStatus, intentStatus, intents, type SkillRun } from './mock-intents'
import Spur from './Spur.svelte'
import BuchhaltungSignatur from './signaturen/BuchhaltungSignatur.svelte'
import HitlSignatur from './signaturen/HitlSignatur.svelte'
import InboxSignatur from './signaturen/InboxSignatur.svelte'
import IntentsSignatur from './signaturen/IntentsSignatur.svelte'

/**
 * EINE Karte pro Skill — die Komposition wird nicht geschachtelt,
 * sondern plattgedrückt: die Spur zeigt die eigenen Schritte als
 * Punktreihe und die Tiefe als eine Pfadzeile. Darunter die SIGNATUR
 * des Skills: ein unverwechselbares Bild dessen, was hier passiert —
 * Dokument→Zeilen bei der Inbox, das T-Konto bei der Buchhaltung, die
 * Entscheidung bei HITL und Intents. Der Rahmen ist überall gleich, die
 * Signatur macht den Skill erkennbar, bevor man den Namen liest.
 */
const { run, alle }: { run: SkillRun; alle: SkillRun[] } = $props()

const SIGNATUREN: Record<string, typeof InboxSignatur> = {
	inbox: InboxSignatur,
	buchhaltung: BuchhaltungSignatur,
	hitl: HitlSignatur,
	intents: IntentsSignatur
}
const Signatur = $derived(run.skillId ? SIGNATUREN[run.skillId] : null)

const lieferant = $derived(alle.find((r) => r.id === run.braucht?.run))

/**
 * Abhängigkeiten auf GANZE Intents (der Monatsabschluss wartet auf alle
 * Beleg-Intents): aufgelöst zu Titel + Status, damit die Karte zeigt,
 * WER den Sammelstand noch aufhält.
 */
const speiser = $derived(
	(run.braucht?.intents ?? [])
		.map((id) => intents.find((i) => i.id === id))
		.filter((i) => i !== undefined)
		.map((i) => ({ titel: i.titel, status: intentStatus(i) }))
)
const GLYPH: Record<IntentStatus, { mark: string; klasse: string }> = {
	fertig: { mark: '✓', klasse: 'text-status-success' },
	'braucht-dich': { mark: '●', klasse: 'text-primary' },
	laeuft: { mark: '◐', klasse: 'text-status-working' }
}

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

	<Spur {run} />

	{#if run.braucht?.intents && run.zustand === 'wartet-ergebnis'}
		<!-- Der Sammelstand: dieser Lauf wartet nicht auf einen Nachbarn,
		     sondern auf GANZE Intents. Jeder Chip ist einer — und man
		     sieht sofort, wer noch aufhält. -->
		<div class="flex flex-col gap-1.5">
			<p class="font-mono text-[0.625rem] text-status-working">
				◇ wartet auf „{run.braucht.was}" —
				{speiser.filter((x) => x.status === 'fertig').length}
				von {speiser.length} liegen vor.
			</p>
			<div class="flex flex-wrap gap-1.5">
				{#each speiser as x (x.titel)}
					<span
						class="flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.6875rem] {x.status ===
						'fertig'
							? 'border-border/60 text-foreground/45'
							: 'border-border bg-surface-card'}"
					>
						<span class="font-mono text-[0.5625rem] {GLYPH[x.status].klasse}">
							{GLYPH[x.status].mark}
						</span>
						{x.titel}
					</span>
				{/each}
			</div>
		</div>
	{:else if run.braucht && run.zustand === 'wartet-ergebnis'}
		<p class="font-mono text-[0.625rem] text-status-working">
			◇ wartet auf „{run.braucht.was}" aus {lieferant?.skill ?? run.braucht.run} — läuft von allein
			weiter, sobald es vorliegt.
		</p>
	{/if}

	{#if Signatur}
		<div class="border-border/60 border-t pt-3">
			<Signatur {run} />
		</div>
	{/if}

	{#if run.zustand === 'wartet-mensch'}
		<p class="text-[0.625rem] text-foreground/40">
			Deine Entscheidung geht als Ereignis zurück in diesen Lauf — Attrappe: hier noch ohne Wirkung.
		</p>
	{/if}
</article>
