<script lang="ts">
/**
 * Activity log viewer — docs-card surface (`bg-white/10` over the cream
 * page, mirroring the Vibe-View Library card on `/docs`) framed by a
 * subtle dotted outer border that evokes invoice/perforation lines.
 * Pure presentational view of an already-filtered log slice; empty-state
 * copy is rendered inline when `logs` is empty.
 *
 * Border choice: `border-2 border-dotted border-border/40` — visible
 * enough to read as a deliberate frame around the panel without
 * competing with the warmer card-surface buttons next to it. The docs
 * card itself uses a solid border; the dotted variant here is the
 * intentional stylistic deviation requested for the activity / display
 * panels (perforation feel).
 */
import { type ActivityEntry, formatLogTime } from './types'

let { logs }: { logs: ActivityEntry[] } = $props()
</script>

<div
	class="min-h-[5rem] flex-1 overflow-y-auto rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 px-2 py-1.5 font-mono text-[10px] leading-relaxed"
>
	{#if logs.length === 0}
		<p class="opacity-40">No activity yet.</p>
	{:else}
		<ul class="flex flex-col gap-0.5">
			{#each logs as log (log.id)}
				<li class="flex items-start gap-1.5">
					<span class="shrink-0 tabular-nums opacity-40">{formatLogTime(log.at)}</span>
					<span class="shrink-0 font-semibold text-foreground/70">
						[{log.skillName}]{log.workerName ? ` (${log.workerName})` : ''}
					</span>
					<span class="opacity-80">{log.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
