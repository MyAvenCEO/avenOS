<script lang="ts">
import { fund, type SkillRun } from '../mock-intents'

/**
 * Die Signatur des HITL-Skills: die Frage an den Menschen — das Stück,
 * der Befund (warum es bei dir liegt), die Handlungen. Nichts sonst:
 * dieser Skill IST die Entscheidung.
 */
const { run }: { run: SkillRun } = $props()
const notiz = $derived(fund<string>(run, 'notiz'))
const befund = $derived(fund<string>(run, 'befund'))
const aktionen = $derived(fund<string[]>(run, 'aktionen') ?? [])
</script>

<div class="flex flex-col gap-2">
	<blockquote class="border-primary/50 border-l-2 pl-3 text-foreground/80 text-sm leading-relaxed">
		{notiz}
	</blockquote>
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
