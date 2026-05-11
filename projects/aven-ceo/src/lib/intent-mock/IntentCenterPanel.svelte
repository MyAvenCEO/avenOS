<script lang="ts">
import { AVENCEO_NAME, activityStreamKindLabel } from './ceo-copy'
import HitlTodoHost from './HitlTodoHost.svelte'
import SkillKanbanBoard from './SkillKanbanBoard.svelte'
import { skillLinesForBinding, skillLinesForSubAgent } from './skill-display'
import type { IntentOrchestrator, RightPanelTab } from './types'

let {
	intent,
	panel,
	onResolveHitl,
	onDemoHitl
}: {
	intent: IntentOrchestrator | null
	panel: RightPanelTab
	onResolveHitl: (
		todoId: string,
		payload:
			| { kind: 'text_reply'; text: string }
			| { kind: 'choice'; optionId: string }
			| { kind: 'approve_reject'; approved: boolean }
	) => void
	onDemoHitl: () => void
} = $props()
</script>

<div class="min-w-0 flex flex-col gap-8 flex-1 min-h-0 overflow-y-auto pr-2">
	{#if !intent}
		<div
			class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 p-12"
		>
			<p class="text-sm opacity-40 text-center max-w-sm">
				Choose an intent on the left to see what {AVENCEO_NAME} and your skills are doing, and when
				your input is needed.
			</p>
		</div>
	{:else if panel === 'overview'}
		<section class="space-y-6">
			<div class="flex items-baseline justify-between gap-4 flex-wrap">
				<div>
					<p class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">{AVENCEO_NAME}</p>
					<h1 class="text-xl font-semibold tracking-tight mt-1">{intent.title}</h1>
					<p class="text-sm opacity-60 mt-2 leading-relaxed max-w-2xl">{intent.summary}</p>
				</div>
				<button
					type="button"
					class="text-[10px] font-bold uppercase border border-dashed border-foreground/25 px-3 py-1.5 rounded-full hover:bg-foreground/5"
					onclick={onDemoHitl}
				>
					Demo Human Review
				</button>
			</div>

			<SkillKanbanBoard subAgents={intent.subAgents} skills={intent.skills} />

			<div>
				<p class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em] mb-3">Human Review</p>
				<HitlTodoHost todos={intent.hitlTodos} onResolve={onResolveHitl} />
			</div>
		</section>
	{:else if panel === 'stream'}
		<section class="space-y-4">
			<div>
				<p class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">Activity</p>
				<h2 class="text-lg font-semibold tracking-tight mt-1">{intent.title}</h2>
				<p class="text-xs opacity-50 mt-1">What happened, in order — in plain language.</p>
			</div>
			<div class="tech-card p-4 space-y-3">
				<ol class="space-y-4">
					{#each intent.activity as row (row.id)}
						{@const sa =
							row.agentId !== undefined
								? intent.subAgents.find((s) => s.id === row.agentId)
								: undefined}
						{@const skillLines = sa ? skillLinesForSubAgent(sa, intent.skills) : null}
						<li class="flex gap-3 text-sm border-b border-border/25 pb-4 last:border-0 last:pb-0">
							<span class="font-mono text-[10px] opacity-35 shrink-0 w-11 pt-0.5">{row.at}</span>
							<div class="min-w-0">
								<span class="text-[9px] font-bold uppercase opacity-45"
									>{activityStreamKindLabel(row.kind)}</span
								>
								{#if skillLines}
									<p class="font-medium text-sm leading-snug mt-0.5">{skillLines.primary}</p>
									<p class="font-mono text-[10px] opacity-40 mt-0.5">{skillLines.secondary}</p>
								{/if}
								<p class="font-medium leading-snug {skillLines ? 'mt-1' : 'mt-0.5'}">{row.title}</p>
								{#if row.detail}
									<p class="text-xs opacity-65 mt-1 leading-relaxed">{row.detail}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ol>
			</div>
		</section>
	{:else}
		<section class="space-y-3 max-w-xl">
			<p class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">Capabilities</p>
			<p class="text-xs opacity-50 leading-relaxed">
				Extra building blocks attached to this intent (for advanced setups).
			</p>
			<ul class="space-y-2">
				{#each intent.skills as s (s.skillId)}
					{@const lines = skillLinesForBinding(s)}
					<li class="tech-card px-4 py-3 flex items-center justify-between gap-3">
						<div>
							<p class="font-medium text-sm leading-snug">{lines.primary}</p>
							<p class="font-mono text-[10px] opacity-40 mt-0.5">{lines.secondary}</p>
						</div>
						<span
							class="text-[10px] font-bold uppercase {s.bound ? 'text-emerald-800' : 'opacity-40'}"
							>{s.bound ? 'Active' : 'Available'}</span
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
