<script lang="ts">
/**
 * "Context" tab body — placeholder surface for the actor's contextual
 * memory. Same dotted perforation chrome as `ActivityView` / `ConfigView`
 * so the four tabs share one visual family. Real context wiring will
 * replace the body later; for now we render a faded header + a short
 * mocked summary line so the empty tab still feels intentional.
 */
import { formatLogTime, type IntentRow, type SkillWorker } from './types'

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
		? `Last skill transition at ${mockTimestamp} — depends on Intent ${intent?.title ?? '—'}`
		: `Last intent transition at ${mockTimestamp} — depends on Skill X, Y, Z`
)
</script>

<div
	class="min-h-[5rem] flex-1 overflow-y-auto rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 p-4 text-[11px] leading-relaxed"
>
	<p class="text-[8px] font-bold tracking-[0.22em] opacity-40 uppercase">
		Context for {actorName}
	</p>
	<p class="mt-2 text-foreground/50">Here is the context of the actor — placeholder.</p>
	<p class="mt-2 font-mono text-[10px] text-foreground/40">{mockContextLine}</p>
</div>
