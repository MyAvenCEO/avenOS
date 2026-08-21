<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'

let downloadUrl = $state('')
let error = $state('')

onMount(async () => {
	try {
		const result = await appRuntime.dashboard.load(page.url)
		if (result.needsPasskey) {
			void goto('/passkey/create')
			return
		}
		downloadUrl = result.downloadUrl
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Load failed.'
	}
})
</script>

<svelte:head><title>Download</title></svelte:head>
<section class="panel auth">
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	{#if downloadUrl}
		<a href={downloadUrl}><button>Download AvenOS</button></a>
	{/if}
</section>
