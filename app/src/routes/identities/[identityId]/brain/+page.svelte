<script lang="ts">
// The BRAIN talk surface: the memory-managed chat (store → assemble L0/L1/L2/L3 context → reply →
// dream), with the Brain roundtrip aside. Same chat UI as plain Talk; the agent runs in `brain`
// mode here (set by the layout from the route) and the layout shows the TalkBrainAside.
import { page } from '$app/state'
import { isBrainEnabled } from '$lib/agent-sidecar/mode'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import IdentityTalkPanel from '$lib/identities/IdentityTalkPanel.svelte'

// Brain is disabled in the .NET sidecar path (D7). The nav item is hidden there, but the route can
// still be reached by typing the URL — show a short disabled notice instead of the brain chat.
const brainEnabled = $derived(isBrainEnabled())

const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
const decodedIdentityId = $derived(decodeURIComponent(identityParam))

const identitiesStore = avenDbStore('safes')

function idsMatch(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const identityMeta = $derived(
	identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId))
)
</script>

<svelte:head>
	<title>{t('nav.brain')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
	{#if brainEnabled}
		<IdentityTalkPanel identityId={decodedIdentityId} sparkName={identityMeta?.name} />
	{:else}
		<div class="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
			<p class="text-foreground text-sm font-semibold">{t('nav.brain')} is disabled</p>
			<p class="text-muted-foreground text-xs leading-relaxed">
				The .NET agent runtime is being integrated and will take over durable memory. The Brain
				view is turned off while that migration is in progress.
			</p>
		</div>
	{/if}
</div>
