<script lang="ts">
import {
	AVENCEO_NAME,
	KANBAN_COLUMN_HEADING,
	type SkillKanbanColumn,
	subAgentKanbanColumn
} from './ceo-copy'
import { skillLinesForSubAgent } from './skill-display'
import type { IntentSkillBinding, SubAgent } from './types'

const COLUMNS: SkillKanbanColumn[] = ['open', 'working', 'review']

let {
	subAgents,
	skills
}: {
	subAgents: SubAgent[]
	skills: IntentSkillBinding[]
} = $props()

const withIndex = $derived(
	subAgents.map((sa) => ({
		sa,
		lines: skillLinesForSubAgent(sa, skills),
		column: subAgentKanbanColumn(sa.status)
	}))
)

function itemsInColumn(col: SkillKanbanColumn) {
	return withIndex.filter((x) => x.column === col)
}
</script>

<div class="tech-card p-4">
	<p class="tech-label mb-3">Skills · managed by {AVENCEO_NAME}</p>
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 min-h-[8rem]">
		{#each COLUMNS as col (col)}
			<div
				class="rounded-lg border border-border/50 bg-foreground/[0.02] p-2 flex flex-col gap-2 min-h-[7rem]"
			>
				<p class="text-[10px] font-bold uppercase opacity-45 tracking-wide px-0.5">
					{KANBAN_COLUMN_HEADING[col]}
				</p>
				<ul class="space-y-2 flex-1">
					{#each itemsInColumn(col) as { sa, lines } (sa.id)}
						<li
							class="rounded-md border border-border/40 bg-background/80 px-2.5 py-2 text-sm shadow-sm"
						>
							<p class="font-medium text-sm tracking-tight leading-snug">{lines.primary}</p>
							<p class="font-mono text-[10px] opacity-40 mt-0.5">{lines.secondary}</p>
							{#if sa.status === 'done'}
								<p class="text-[10px] font-bold uppercase text-emerald-800/90 mt-1.5">Complete</p>
							{:else if sa.status === 'blocked_hitl' && sa.blockedReason}
								<p class="text-[11px] text-amber-900/80 mt-1.5 leading-snug">{sa.blockedReason}</p>
							{/if}
						</li>
					{:else}
						<li class="text-[11px] opacity-35 px-0.5 py-2 italic">—</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</div>
