<script lang="ts">
import { AVENCEO_ACTOR_ID } from './boring-avatar'
import { AVENCEO_NAME, activityStreamKindLabel } from './ceo-copy'
import HitlTodoHost from './HitlTodoHost.svelte'
import { activityMatchesActorFilter } from './involved-actors-display'
import type { InvolvedActorId } from './involved-actors-display'
import { skillLinesForBinding, skillLinesForSubAgent } from './skill-display'
import type { ActorContextTab, IntentOrchestrator } from './types'

let {
	intent,
	panel,
	selectedActorId,
	onResolveHitl
}: {
	intent: IntentOrchestrator | null
	panel: ActorContextTab
	selectedActorId: InvolvedActorId
	onResolveHitl: (
		todoId: string,
		payload:
			| { kind: 'text_reply'; text: string }
			| { kind: 'choice'; optionId: string }
			| { kind: 'approve_reject'; approved: boolean }
	) => void
} = $props()

const filteredActivity = $derived.by(() => {
	if (!intent || panel !== 'overview') return []
	return intent.activity.filter((row) =>
		activityMatchesActorFilter(intent, row, selectedActorId)
	)
})

/** Human review (HITL) on the lead skill; in dev, static layout examples are appended. */
const showHitlOnOverview = $derived.by(() => {
	if (!intent || selectedActorId !== AVENCEO_ACTOR_ID) return false
	const openTodos = intent.hitlTodos.some((t) => t.status === 'open')
	const blocked = intent.subAgents.some((s) => s.status === 'blocked_hitl')
	return openTodos || blocked
})

</script>

<div class="min-w-0 flex flex-1 flex-col min-h-0 gap-3 overflow-hidden">
	{#if !intent}
		<div
			class="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border/60 p-12"
		>
			<p class="text-sm opacity-40 text-center max-w-sm">
				Choose an intent on the left to see what {AVENCEO_NAME} and your skills are doing, and when
				your input is needed.
			</p>
		</div>
	{:else}
		<div class="min-w-0 shrink-0">
			<div class="flex shrink-0 items-center gap-2 mb-1.5 min-w-0">
				<span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">{AVENCEO_NAME}</span>
			</div>
			<div class="min-w-0 space-y-1">
				<h1 class="text-[15px] sm:text-base font-semibold tracking-tight leading-snug">
					{intent.title}
				</h1>
				<p class="text-[11px] opacity-55 leading-snug line-clamp-2 max-w-2xl">
					{intent.summary}
				</p>
			</div>
		</div>

		<div
			class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain pr-2 scrollbar-gutter-stable pb-8"
		>
			{#if panel === 'overview'}
				<section class="max-w-2xl space-y-5">
					{#if showHitlOnOverview}
						<div class="space-y-2">
							<p class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Human review</p>
							<HitlTodoHost todos={intent.hitlTodos} onResolve={onResolveHitl} />
						</div>
					{/if}

					<div class="min-w-0 space-y-2">
						<p class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Activity</p>
						{#if filteredActivity.length === 0}
							<p class="py-3 text-center text-[11px] opacity-45">
								{intent.activity.length === 0
									? 'No activity yet.'
									: 'No activity for this skill.'}
							</p>
						{:else}
							<ol class="divide-y divide-border/20 space-y-0">
								{#each filteredActivity as row (row.id)}
									{@const sa =
										row.agentId !== undefined
											? intent.subAgents.find((s) => s.id === row.agentId)
											: undefined}
									{@const skillLines = sa ? skillLinesForSubAgent(sa, intent.skills) : null}
									<li class="flex gap-2 py-2.5 text-[12px] leading-snug first:pt-0">
										<span class="w-9 shrink-0 pt-0.5 font-mono text-[9px] tabular-nums opacity-35"
											>{row.at}</span
										>
										<div class="min-w-0 flex-1">
											<span class="text-[9px] font-bold uppercase tracking-wide opacity-40"
												>{activityStreamKindLabel(row.kind)}</span
											>
											{#if skillLines}
												<p class="mt-0.5 text-[12px] font-medium leading-snug">{skillLines.primary}</p>
												<p class="mt-0.5 font-mono text-[9px] opacity-40">{skillLines.secondary}</p>
											{/if}
											<p class="font-medium text-[12px] leading-snug {skillLines ? 'mt-1' : 'mt-0.5'}">
												{row.title}
											</p>
											{#if row.detail}
												<p class="mt-1 text-[11px] leading-relaxed opacity-60">{row.detail}</p>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				</section>
			{:else if panel === 'config'}
				<section class="max-w-2xl">
					<div class="tech-card space-y-4 p-3 sm:p-4">
						<div>
							<p class="text-[10px] font-bold uppercase opacity-40 tracking-wide mb-2">Tools</p>
							<ul class="text-sm space-y-2 opacity-90">
								<li class="flex justify-between gap-3 border-b border-border/20 pb-2">
									<span class="font-mono text-xs">read_workspace_file</span>
									<span class="text-[10px] uppercase text-emerald-800 font-bold">On</span>
								</li>
								<li class="flex justify-between gap-3 border-b border-border/20 pb-2">
									<span class="font-mono text-xs">delegate_to_skill</span>
									<span class="text-[10px] uppercase text-emerald-800 font-bold">On</span>
								</li>
								<li class="flex justify-between gap-3">
									<span class="font-mono text-xs">sandbox_exec</span>
									<span class="text-[10px] uppercase opacity-40 font-bold">Off</span>
								</li>
							</ul>
						</div>
						<div>
							<p class="text-[10px] font-bold uppercase opacity-40 tracking-wide mb-2">LLM</p>
							<dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
								<dt class="opacity-45">Model</dt>
								<dd class="font-mono text-xs">glm-5-1 · structured</dd>
								<dt class="opacity-45">Temperature</dt>
								<dd class="font-mono text-xs">0.2 (mock)</dd>
								<dt class="opacity-45">Skill</dt>
								<dd class="font-mono text-xs">{intent.orchestratorLabel}</dd>
							</dl>
						</div>
					</div>
				</section>
			{:else}
				<section class="max-w-2xl space-y-3">
						<details class="tech-card group" open>
							<summary
								class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none"
							>
								SOUL.md
								<span
									class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform"
									>▾</span
								>
							</summary>
							<div
								class="px-3 pb-3 sm:px-4 sm:pb-4 text-xs opacity-75 leading-relaxed border-t border-border/30 pt-3 font-mono"
							>
								You are a careful specialist under {AVENCEO_NAME}. Prefer small, verifiable steps. Ask
								the human when policy is unclear.
							</div>
						</details>

						<details class="tech-card group">
							<summary
								class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none"
							>
								Workspace rules
								<span
									class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform"
									>▾</span
								>
							</summary>
							<div
								class="px-3 pb-3 sm:px-4 sm:pb-4 text-xs opacity-75 leading-relaxed border-t border-border/30 pt-3 font-mono"
							>
								— Never exfiltrate secrets.<br>
								— Cite file paths when claiming facts.<br>
								— Escalate blocked HITL items with a one-line reason.
							</div>
						</details>

						<details class="tech-card group">
							<summary
								class="cursor-pointer list-none px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 text-sm font-semibold tracking-tight marker:content-none"
							>
								Skill bindings (preview)
								<span
									class="text-[10px] font-bold uppercase opacity-35 group-open:rotate-180 transition-transform"
									>▾</span
								>
							</summary>
							<ul class="px-3 pb-3 sm:px-4 sm:pb-4 space-y-2 border-t border-border/30 pt-3">
								{#each intent.skills as s (s.skillId)}
									{@const lines = skillLinesForBinding(s)}
									<li class="text-sm">
										<p class="font-medium leading-snug">{lines.primary}</p>
										<p class="font-mono text-[10px] opacity-40 mt-0.5">{lines.secondary}</p>
									</li>
								{/each}
							</ul>
						</details>
				</section>
			{/if}
		</div>
	{/if}
</div>
