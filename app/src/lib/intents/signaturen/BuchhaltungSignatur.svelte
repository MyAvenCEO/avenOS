<script lang="ts">
import { fund, type SkillRun } from '../mock-intents'

/**
 * Die Signatur der Buchhaltung: das T-Konto. Soll und Haben, unten die
 * ausgeglichene Summe — plus die Zahlung, die dazugehört, und die
 * Festschreibung als Handlung bzw. Stempel. Wer das Bild kennt, weiß
 * ohne ein Wort, welcher Skill hier arbeitet.
 */
const { run }: { run: SkillRun } = $props()
const zeilen = $derived(
	fund<{ konto: string; bez: string; soll: string; haben: string }[]>(run, 'zeilen') ?? []
)
const summe = $derived(fund<string>(run, 'summe'))
const gewaehlt = $derived(fund<string>(run, 'gewaehlt'))
const freigabe = $derived(fund<string>(run, 'freigabe'))
const festschreibbar = $derived(fund<boolean>(run, 'festschreibbar'))
const festgeschrieben = $derived(fund<string>(run, 'festgeschrieben'))
</script>

<div class="flex flex-col gap-2 {run.zustand === 'wartet-ergebnis' ? 'opacity-50' : ''}">
	{#if zeilen.length === 0}
		<p class="text-foreground/40 text-xs">— Zeilen entstehen aus den Positionen —</p>
	{:else}
		<div class="grid grid-cols-[1fr_auto_auto] gap-x-4 font-mono text-[0.6875rem]">
			<span class="text-[0.5625rem] text-foreground/35 uppercase">Konto</span>
			<span class="text-right text-[0.5625rem] text-foreground/35 uppercase">Soll</span>
			<span class="text-right text-[0.5625rem] text-foreground/35 uppercase">Haben</span>
			{#each zeilen as z (z.konto)}
				<span class="truncate py-0.5"
					>{z.konto} <span class="text-foreground/50">{z.bez}</span></span
				>
				<span class="py-0.5 text-right">{z.soll}</span>
				<span class="py-0.5 text-right">{z.haben}</span>
			{/each}
			{#if summe}
				<span class="border-border border-t pt-1 text-[0.625rem] text-foreground/45"
					>ausgeglichen</span
				>
				<span class="border-border border-t pt-1 text-right text-status-success">{summe}</span>
				<span class="border-border border-t pt-1 text-right text-status-success">{summe}</span>
			{/if}
		</div>
	{/if}

	{#if gewaehlt}
		<p class="font-mono text-[0.625rem] text-foreground/45">
			<span class="text-status-success">⇄</span>
			{gewaehlt}{freigabe ? ` · ${freigabe}` : ''}
		</p>
	{/if}

	{#if festgeschrieben}
		<p class="font-mono text-[0.625rem] text-status-success">
			✓ festgeschrieben · {festgeschrieben}
		</p>
	{:else if festschreibbar && run.zustand === 'wartet-mensch'}
		<div class="flex items-center gap-3 pt-0.5">
			<button
				type="button"
				class="rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground text-xs"
			>
				Festschreiben
			</button>
			<span class="text-[0.625rem] text-foreground/40">danach unveränderlich — GoBD</span>
		</div>
	{/if}
</div>
