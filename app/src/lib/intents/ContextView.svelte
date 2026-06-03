<script lang="ts">
/**
 * "Context" tab body — placeholder surface for the actor's contextual
 * memory. Same dotted perforation chrome as `ActivityView` / `ConfigView`
 * so the four tabs share one visual family. Real context wiring will
 * replace the body later; for now we render a faded header + a short
 * mocked summary line so the empty tab still feels intentional.
 */
import { formatLogTime, type IntentRow, type SkillWorker } from './types'
import { t } from '$lib/i18n'

let {
	intent,
	skill
}: {
	intent: IntentRow | null
	skill: SkillWorker | null
} = $props()

const actorName = $derived(skill?.name ?? intent?.title ?? 'unknown actor')
const actorLogs = $derived.by(() => {
	if (!intent) return []
	if (!skill) return intent.logs.slice(-5)
	return intent.logs.filter((entry) => entry.skillName === skill.name).slice(-5)
})

const actorSummary = $derived(
	skill?.runtimeSummary
		?? actorLogs.at(-1)?.text
		?? (skill
			? t('intents.context.skillTransition', { time: formatLogTime(Date.now()), intent: intent?.title ?? '—' })
			: t('intents.context.intentTransition', { time: formatLogTime(Date.now()) }))
)
</script>

<div
	class="min-h-[5rem] flex-1 overflow-y-auto rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 p-4 text-[11px] leading-relaxed"
>
	<p class="text-[8px] font-bold tracking-[0.22em] opacity-40 uppercase">
		{t('intents.context.header', { actor: actorName })}
	</p>
	<p class="mt-2 text-foreground/70">{actorSummary}</p>
	{#if skill?.runtimeData !== undefined}
		<pre class="mt-3 whitespace-pre-wrap break-words rounded-[var(--radius-lg)] bg-black/5 p-3 font-mono text-[10px] text-foreground/70">{JSON.stringify(skill.runtimeData, null, 2)}</pre>
	{/if}
	{#if actorLogs.length > 0}
		<ul class="mt-3 flex flex-col gap-1 border-t border-border/30 pt-3 font-mono text-[10px] text-foreground/50">
			{#each actorLogs as log (log.id)}
				<li>
					<span class="opacity-40">{formatLogTime(log.at)}</span>
					<span class="ml-2">{log.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
