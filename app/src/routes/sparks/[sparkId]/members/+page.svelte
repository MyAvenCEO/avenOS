<script lang="ts">
	import { page } from '$app/state'
	import SparkMembersPanel from '$lib/sparks/SparkMembersPanel.svelte'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const sparkId = $derived(decodeURIComponent(sparkParam))
</script>

<SparkMembersPanel {sparkId} wide />
