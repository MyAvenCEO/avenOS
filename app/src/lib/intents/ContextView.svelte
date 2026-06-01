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

const mockTimestamp = $derived(formatLogTime(Date.now()))

const mockContextLine = $derived(
	skill
		? t('intents.context.skillTransition', {
				time: mockTimestamp,
				intent: intent?.title ?? '—',
			})
		: t('intents.context.intentTransition', { time: mockTimestamp }),
)
</script>

<div
	class="min-h-[5rem] flex-1 overflow-y-auto rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 p-4 text-[11px] leading-relaxed"
>
	<p class="text-[8px] font-bold tracking-[0.22em] opacity-40 uppercase">
		{t('intents.context.header', { actor: actorName })}
	</p>
	<p class="mt-2 text-foreground/50">{t('intents.context.placeholder')}</p>
	<p class="mt-2 font-mono text-[10px] text-foreground/40">{mockContextLine}</p>
</div>
