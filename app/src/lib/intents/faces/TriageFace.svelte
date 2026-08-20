<script lang="ts">
import type { SkillRun } from '../mock-intents'

/**
 * Das Gesicht des Einordnens: die Notiz selbst, der Befund des Modells
 * (warum sie hier gelandet ist) und die Handlungen, die das Rezept dem
 * Menschen anbietet — ein völlig anderer Skill im SELBEN Rahmen: genau
 * das beweist, dass Cockpit und Karte generisch sind.
 */
const { run }: { run: SkillRun } = $props()
const d = $derived(run.daten as { notiz?: string; befund?: string; aktionen?: string[] })
</script>

<div class="flex flex-col gap-2.5">
	<blockquote
		class="border-border border-l-2 pl-3 text-foreground/70 text-sm italic leading-relaxed"
	>
		{d.notiz}
	</blockquote>
	{#if d.befund}
		<p class="font-mono text-[0.625rem] text-foreground/40">{d.befund}</p>
	{/if}
	{#if run.zustand === 'wartet-mensch'}
		<div class="flex flex-wrap gap-2">
			{#each d.aktionen ?? [] as a, i (a)}
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
