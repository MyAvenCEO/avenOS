<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { api } from '$lib/api.js'
import type { MetaInfo, PasskeyStatus } from '$lib/types.js'

let downloadUrl = $state('')
let error = $state('')

onMount(async () => {
	try {
		const [status, meta] = await Promise.all([
			api<PasskeyStatus>('/passkeys'),
			api<MetaInfo>('/meta')
		])
		const complete = status.passkeys.some(
			(passkey) => !meta.requirePasskeyPrf || passkey.prf_enabled
		)
		if (!complete) {
			void goto('/passkey/create')
			return
		}
		downloadUrl = meta.downloadUrl
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
