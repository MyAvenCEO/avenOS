<script lang="ts">
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { avenCeoSparkId } from '$lib/jazz/api'
	import IdentityMembersPanel from '$lib/identities/IdentityMembersPanel.svelte'

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const identityId = $derived(decodeURIComponent(identityParam))

	// Is this the well-known avenCEO control identity? If so, onboarding uses the
	// membership bundle (reads + keyshare + row-scoped self-publish write) and the
	// self-publish UI is shown.
	let avenCeoId = $state<string | undefined>(undefined)
	$effect(() => {
		if (!browser) return
		void (async () => {
			try {
				avenCeoId = await avenCeoSparkId()
			} catch {
				avenCeoId = undefined
			}
		})()
	})
	const isAvenCeo = $derived(!!avenCeoId && identityId === avenCeoId)
</script>

<IdentityMembersPanel {identityId} {isAvenCeo} wide />
