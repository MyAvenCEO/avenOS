<script lang="ts">
import AvenUiView from '$lib/aven-ui/AvenUiView.svelte'
import { vibeViewById } from '$lib/aven-ui/vibe-views'
import { t } from '$lib/i18n'
/**
 * "Display" tab body — renders an aven-ui view in place, branching on the
 * parent intent's status:
 *
 * - `error`: the aven-ui **error** vibe (`vibes/error`), sourced from the
 *   intent (title + a deterministic mock failure reason hashed from
 *   `intent.id` so the same intent always shows the same reason).
 * - `success`: the aven-ui **success** vibe (`vibes/success`).
 * - HITL (any other state with a cached `hitlVibeAppId`): the chosen vibe view
 *   via `vibeViewById`.
 *
 * All three mount through the shared `AvenUiView` (QuickJS session +
 * `AvenUiEngine`), keyed on `intent.id:branch` so switching intent/branch
 * re-mounts with a fresh init.
 */
import type { IntentRow } from './types'

let { intent }: { intent: IntentRow } = $props()

const MOCK_ERROR_REASON_KEYS = [
	'approvalPolicy',
	'vendorLookup',
	'validationRules',
	'networkTimeout'
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
		`intents.display.errorReasons.${MOCK_ERROR_REASON_KEYS[hashIntentId(intent.id) % MOCK_ERROR_REASON_KEYS.length]}`
	)
)

const errorView = vibeViewById('error')
const successView = vibeViewById('success')

const errorSource = $derived({
	badge: t('intents.display.systemError'),
	eyebrow: t('intents.display.automationHalted'),
	title: intent.title,
	messageLabel: t('intents.display.reason'),
	message: errorReason
})

const successSource = $derived({
	badge: t('intents.display.successBadge'),
	eyebrow: t('intents.display.automationComplete'),
	title: intent.title,
	messageLabel: t('intents.display.result'),
	message: t('intents.display.successMessage')
})

const hitlView = $derived(intent.hitlVibeAppId ? vibeViewById(intent.hitlVibeAppId) : null)
</script>

{#if intent.status === 'error'}
	<div class="flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-[var(--radius-lg)] bg-white/10">
		{#key `${intent.id}:error`}
			<AvenUiView
				shell={errorView.shell}
				containerName={errorView.containerName}
				source={errorSource}
			/>
		{/key}
	</div>
{:else if intent.status === 'success'}
	<div
		class="mt-5 flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-[var(--radius-lg)] bg-white/10 sm:mt-6"
	>
		{#key `${intent.id}:success`}
			<AvenUiView
				shell={successView.shell}
				containerName={successView.containerName}
				source={successSource}
			/>
		{/key}
	</div>
{:else if hitlView}
	<div
		class="mt-5 flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-[var(--radius-lg)] bg-white/10 sm:mt-6"
	>
		{#key `${intent.id}:${intent.hitlVibeAppId}`}
			<AvenUiView
				shell={hitlView.shell}
				containerName={hitlView.containerName}
				interactive={hitlView.interactive}
			/>
		{/key}
	</div>
{/if}
