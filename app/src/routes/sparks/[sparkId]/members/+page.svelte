<script lang="ts">
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { avenCeoSparkId } from '$lib/jazz/api'
	import SparkMembersPanel from '$lib/sparks/SparkMembersPanel.svelte'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const sparkId = $derived(decodeURIComponent(sparkParam))

	// Is this the well-known avenCEO control spark? If so, onboarding uses the
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
	const isAvenCeo = $derived(!!avenCeoId && sparkId === avenCeoId)
</script>

<SparkMembersPanel {sparkId} {isAvenCeo} wide />
