<script lang="ts">
import type { SkillRun } from '../mock-intents'

/**
 * Das Gesicht des Matchmakers: Kandidaten mit Güte-Balken, solange die
 * Wahl offen ist; danach die bestätigte Verknüpfung Rechnung ⇄ Zahlung.
 * Die Knöpfe sind ECHTE Knöpfe — hier soll jemand drücken.
 */
const { run }: { run: SkillRun } = $props()
const d = $derived(
	run.daten as {
		kandidaten?: { id: string; datum: string; betrag: string; text: string; score: number }[]
		gewaehlt?: string
		score?: number
		freigabe?: string
	}
)
</script>

<div class="flex flex-col gap-2">
	{#if d.gewaehlt}
		<p class="text-xs">
			<span class="pr-1 font-mono text-status-success">⇄</span>
			{d.gewaehlt}
			<span class="pl-1 font-mono text-[0.625rem] text-foreground/40">
				{Math.round((d.score ?? 0) * 100)}
				%
			</span>
		</p>
		{#if d.freigabe}
			<p class="font-mono text-[0.625rem] text-foreground/35">{d.freigabe}</p>
		{/if}
	{:else if (d.kandidaten ?? []).length === 0}
		<p class="text-foreground/40 text-xs">— noch keine Kandidaten —</p>
	{:else}
		{#each d.kandidaten ?? [] as k (k.id)}
			<div class="flex items-center gap-3">
				<div class="min-w-0 flex-1">
					<p class="truncate text-xs">
						<span class="font-mono text-foreground/40">{k.datum}</span>
						<span class="px-1 font-medium">{k.betrag}</span>
						<span class="text-foreground/60">„{k.text}"</span>
					</p>
					<div class="mt-1 h-1 overflow-hidden rounded-full bg-border/60">
						<div
							class="h-full rounded-full bg-primary/70"
							style="width: {Math.round(k.score * 100)}%"
						></div>
					</div>
				</div>
				<span class="w-9 shrink-0 text-right font-mono text-[0.625rem] text-foreground/50">
					{Math.round(k.score * 100)}
					%
				</span>
				<button
					type="button"
					class="shrink-0 rounded-full border border-border bg-surface-card px-3 py-1 text-xs transition-colors hover:border-primary/50"
				>
					verknüpfen
				</button>
			</div>
		{/each}
		<button
			type="button"
			class="self-start pt-1 text-[0.6875rem] text-foreground/45 underline-offset-2 hover:underline"
		>
			kein Treffer — später erneut suchen
		</button>
	{/if}
</div>
