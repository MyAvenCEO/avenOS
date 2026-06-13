<script lang="ts">
// The BRAIN talk surface: the memory-managed chat (store → assemble L0/L1/L2/L3 context → reply →
// dream), with the Brain roundtrip aside. Same chat UI as plain Talk; the agent runs in `brain`
// mode here (set by the layout from the route) and the layout shows the TalkBrainAside.
import { page } from '$app/state'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import IdentityTalkPanel from '$lib/identities/IdentityTalkPanel.svelte'

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
	<IdentityTalkPanel identityId={decodedIdentityId} sparkName={identityMeta?.name} />
</div>
