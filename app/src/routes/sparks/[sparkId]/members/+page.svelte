<script lang="ts">
	import { page } from '$app/state'
	import SparkMembersPanel from '$lib/sparks/SparkMembersPanel.svelte'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const sparkId = $derived(decodeURIComponent(sparkParam))
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
	<SparkMembersPanel {sparkId} wide />
</div>
