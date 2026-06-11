<script lang="ts">
import { page } from '$app/state'
import { avenDbStore } from '$lib/avendb/store.svelte'
import { t } from '$lib/i18n'
import IdentityTalkPanel from '$lib/identities/IdentityTalkPanel.svelte'
import TalkBrainAside from '$lib/identities/TalkBrainAside.svelte'

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
	<title>{t('identities.talk.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-row">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<IdentityTalkPanel identityId={decodedIdentityId} sparkName={identityMeta?.name} />
	</div>
	<!-- E5 v1: the brain roundtrip aside — latest stored/recalled for the last message. -->
	<aside class="border-border/60 bg-card/20 hidden w-[24rem] min-h-0 shrink-0 border-l xl:flex">
		<TalkBrainAside identityId={decodedIdentityId} />
	</aside>
</div>
