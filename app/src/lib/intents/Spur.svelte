<script lang="ts">
import { type SkillRun, spur } from './mock-intents'

/**
 * Der EINE Fortschritts-Baustein, minimal: die eigenen Schritte als
 * Punktreihe — beschriftet ist nur, was gerade dran ist — und darunter,
 * NUR wenn die Arbeit tiefer steckt, eine einzige Pfadzeile bis zum
 * Blatt. Keine Schachteln, keine wiederholten Stepper: Tiefe ist eine
 * Breadcrumb, egal ob eine Ebene oder fünf.
 */
const { run }: { run: SkillRun } = $props()

const s = $derived(spur(run))

const MARK: Record<string, string> = { done: '●', current: '◐', blocked: '◇', pending: '○' }
const FARBE: Record<string, string> = {
	done: 'text-status-success',
	current: 'text-primary',
	blocked: 'text-status-working',
	pending: 'text-foreground/25'
}
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-1.5">
		{#each run.schritte as st (st.name)}
			<span class="font-mono text-[0.5625rem] {FARBE[st.zustand]}" title={st.name}>
				{MARK[st.zustand]}
			</span>
			{#if st.zustand === 'current'}
				<span class="pr-1 font-medium text-foreground text-xs">{st.name}</span>
			{/if}
		{/each}
		{#if run.zustand === 'fertig'}
			<span class="pl-1 text-[0.6875rem] text-foreground/40"> {s.erledigt} Schritte </span>
		{/if}
	</div>

	{#if s.pfad.length > 1}
		<p class="font-mono text-[0.625rem] text-foreground/45">
			└ {s.pfad.slice(1, -1).join(' ▸ ')}{s.pfad.length > 2 ? ' ▸ ' : ''}
			<span class="font-medium text-primary">◐ {s.pfad.at(-1)}</span>
		</p>
	{/if}
</div>
