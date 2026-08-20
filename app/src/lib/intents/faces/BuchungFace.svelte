<script lang="ts">
import type { SkillRun } from '../mock-intents'

/**
 * Das Gesicht des Verbuchens: die Buchungszeilen als Vorschau — gedimmt,
 * solange der Abgleich auf den Treffer wartet; mit Festschreiben-Knopf,
 * wenn der Mensch dran ist; mit Journal-Stempel, wenn es vollbracht ist.
 */
const { run }: { run: SkillRun } = $props()
const d = $derived(
	run.daten as {
		zeilen?: { konto: string; bez: string; soll: string; haben: string }[]
		festschreibbar?: boolean
		festgeschrieben?: string
	}
)
</script>

<div class="flex flex-col gap-2 {run.zustand === 'wartet-ergebnis' ? 'opacity-55' : ''}">
	{#if (d.zeilen ?? []).length === 0}
		<p class="text-foreground/40 text-xs">— Zeilen entstehen aus dem Beleg —</p>
	{:else}
		<table class="w-full font-mono text-[0.6875rem]">
			<thead>
				<tr class="text-left text-[0.625rem] text-foreground/40">
					<th class="pb-1 font-normal">Konto</th>
					<th class="pb-1 font-normal"></th>
					<th class="pb-1 text-right font-normal">Soll</th>
					<th class="pb-1 text-right font-normal">Haben</th>
				</tr>
			</thead>
			<tbody>
				{#each d.zeilen ?? [] as z (z.konto)}
					<tr class="border-border/50 border-t">
						<td class="py-1 pr-3">{z.konto}</td>
						<td class="py-1 pr-3 text-foreground/60">{z.bez}</td>
						<td class="py-1 text-right">{z.soll}</td>
						<td class="py-1 text-right">{z.haben}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if d.festgeschrieben}
		<p class="font-mono text-[0.625rem] text-status-success">
			✓ festgeschrieben · {d.festgeschrieben}
		</p>
	{:else if d.festschreibbar && run.zustand === 'wartet-mensch'}
		<div class="flex items-center gap-3 pt-1">
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
