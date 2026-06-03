<script lang="ts">
/**
 * "Config" tab body — pretty-prints a sample/random configuration object
 * for the current actor (selected skill if any, otherwise the parent
 * intent). Pure presentational stub: the config shape and values are
 * mocked here so the tab can be wired into the panel ahead of any real
 * config plumbing.
 *
 * Visual chrome mirrors `ActivityView`: dotted perforation border on the
 * cream `bg-white/10` docs-card surface so the four tabs feel like one
 * panel family.
 */
import type { IntentRow, SkillWorker } from './types'

let {
	intent,
	skill
}: {
	intent: IntentRow | null
	skill: SkillWorker | null
} = $props()

const actorConfig = $derived.by(() => {
	if (skill?.runtimeData !== undefined) {
		return {
			actorId: skill.id,
			actorName: skill.name,
			actorType: skill.templateId.startsWith('runtime-actor:') ? 'runtime-actor' : 'skill',
			summary: skill.runtimeSummary,
			data: skill.runtimeData,
		}
	}
	return {
		actorId: skill?.id ?? intent?.id ?? 'none',
		actorName: skill?.name ?? intent?.title ?? 'none',
		runtime: { timeoutMs: 30000, maxRetries: 3, parallelism: 1 },
		resources: { cpu: '500m', memory: '256Mi' },
		featureFlags: { observability: true, smartRetry: false }
	}
})
</script>

<div
	class="min-h-[5rem] flex-1 overflow-y-auto rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 p-4 font-mono text-[10px] leading-relaxed"
>
	<pre class="m-0 whitespace-pre-wrap break-words opacity-80">{JSON.stringify(
			actorConfig,
			null,
			2
		)}</pre>
</div>
