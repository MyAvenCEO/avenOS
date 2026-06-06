<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import IdentityTalkPanel from '$lib/identities/IdentityTalkPanel.svelte'

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))

	const identitiesStore = jazzStore('identities')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const identityMeta = $derived(identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId)))
</script>

<svelte:head>
	<title>{t('identities.talk.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
	<IdentityTalkPanel identityId={decodedIdentityId} sparkName={identityMeta?.name} />
</div>
