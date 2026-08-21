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

<svelte:head><title>Download · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Dein avenOS</h1>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	{#if downloadUrl}
		<p>Lade die App und melde dich darin mit deinem Passkey an.</p>
		<a href={downloadUrl}><button>avenOS herunterladen</button></a>
	{/if}
</section>
