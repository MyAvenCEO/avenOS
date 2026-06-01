<script lang="ts">
/**
 * "Display" tab body — branches on the parent intent's status:
 *
 * - `error`: renders an inline appshell-style diagnostic panel (no iframe)
 *   matching the docs-card surface (`bg-white/10` over the cream page) plus
 *   the same dotted border treatment used by the activity log and the
 *   invoice/perforation feel. Surfaces the intent title, a deterministic
 *   mock failure reason, and a hint pointing at the bottom-bar Re-train /
 *   Archive controls. The reason is hashed from `intent.id` so the same
 *   intent always shows the same reason across re-renders.
 *
 * - HITL (any non-error state with a cached `hitlVibeAppId`): wraps the
 *   cross-origin `VibeSandboxFrame` for the chosen vibe-view app. The
 *   shell mirrors the docs-card surface seen on `/docs`. Keyed on
 *   `intent.id:hitlVibeAppId` so resuming an intent or switching to a
 *   different intent re-mounts the frame with a fresh init.
 *
 * Border choice (error variant + activity log): `border-2 border-dotted
 * border-border/40` — visible enough to read as a deliberate frame around
 * the panel without competing with the warmer card-surface buttons next
 * to it. The HITL iframe variant intentionally omits the dotted border
 * because the iframe contents own the chrome inside.
 */
import type { IntentRow } from './types'
import VibeSandboxFrame from '$lib/vibe-apps/VibeSandboxFrame.svelte'
import { t } from '$lib/i18n'

let { intent }: { intent: IntentRow } = $props()

const MOCK_ERROR_REASON_KEYS = [
	'approvalPolicy',
	'vendorLookup',
	'validationRules',
	'networkTimeout',
] as const

function hashIntentId(id: string): number {
	let h = 0
	for (let i = 0; i < id.length; i++) {
		h = (h * 31 + id.charCodeAt(i)) | 0
	}
	return Math.abs(h)
}

const errorReason = $derived(
	t(
		`intents.display.errorReasons.${MOCK_ERROR_REASON_KEYS[hashIntentId(intent.id) % MOCK_ERROR_REASON_KEYS.length]}`,
	),
)
</script>

{#if intent.status === 'error'}
	<div
		class="flex min-h-[400px] min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border-2 border-dotted border-border/40 bg-white/10 px-4 py-4"
	>
		<div class="flex items-center gap-2">
			<span
				class="inline-flex items-center rounded-full border border-status-error/40 bg-status-error/10 px-2 py-0.5 text-[9px] font-semibold tracking-[0.18em] text-status-error uppercase"
			>
				{t('intents.display.systemError')}
			</span>
		</div>
		<div class="flex flex-col gap-1">
			<p class="text-[8px] font-bold tracking-[0.22em] opacity-40 uppercase">{t('intents.display.automationHalted')}</p>
			<h2 class="text-base leading-snug font-semibold text-foreground">{intent.title}</h2>
		</div>
		<p class="text-[12px] leading-relaxed text-status-error">
			<span class="font-semibold">{t('intents.display.reason')}</span>
			{errorReason}
		</p>
		<p class="mt-auto text-[11px] leading-relaxed opacity-65">
			{t('intents.display.errorHint')}
		</p>
	</div>
{:else if intent.hitlVibeAppId}
	<div
		class="mt-5 flex min-h-[400px] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-white/10 sm:mt-6"
	>
		{#key `${intent.id}:${intent.hitlVibeAppId}`}
			<VibeSandboxFrame appId={intent.hitlVibeAppId} />
		{/key}
	</div>
{/if}
