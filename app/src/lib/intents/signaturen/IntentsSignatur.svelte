<script lang="ts">
import { fund, type SkillRun } from '../mock-intents'

/**
 * Die Signatur des Intents-Skills: das Urteil mit seinen Alternativen —
 * Klassen als Balken, gemessen und ehrlich (unter der Schwelle heißt:
 * deine Wahl), darunter die Handlungen.
 */
const { run }: { run: SkillRun } = $props()
const notiz = $derived(fund<string>(run, 'notiz'))
const klassen = $derived(fund<{ label: string; wert: number }[]>(run, 'klassen') ?? [])
const befund = $derived(fund<string>(run, 'befund'))
const aktionen = $derived(fund<string[]>(run, 'aktionen') ?? [])
</script>

<div class="flex flex-col gap-2">
	<blockquote
		class="border-border border-l-2 pl-3 text-foreground/70 text-sm italic leading-relaxed"
	>
		{notiz}
	</blockquote>
	<div class="flex flex-col gap-1">
		{#each klassen as k (k.label)}
			<div class="flex items-center gap-2">
				<span class="w-20 shrink-0 text-[0.6875rem] text-foreground/60">{k.label}</span>
				<div class="h-1 flex-1 overflow-hidden rounded-full bg-border/50">
					<div
						class="h-full rounded-full bg-border-strong"
						style="width: {Math.round(k.wert * 100)}%"
					></div>
				</div>
				<span class="w-8 shrink-0 text-right font-mono text-[0.625rem] text-foreground/45">
					{Math.round(k.wert * 100)}
					%
				</span>
			</div>
		{/each}
	</div>
	{#if befund}
		<p class="font-mono text-[0.625rem] text-foreground/45">{befund}</p>
	{/if}
	{#if run.zustand === 'wartet-mensch'}
		<div class="flex flex-wrap gap-2 pt-0.5">
			{#each aktionen as a, i (a)}
				<button
					type="button"
					class="rounded-full px-3.5 py-1.5 text-xs {i === 0
						? 'bg-primary font-medium text-primary-foreground'
						: 'border border-border bg-surface-card hover:border-primary/50'}"
				>
					{a}
				</button>
			{/each}
		</div>
	{/if}
</div>
