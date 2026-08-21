<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'

let busy = $state(false)
let message = $state('')

onMount(() => {
	if (page.url.searchParams.get('access') === 'invalid')
		message = 'Dieser Link gilt nicht mehr. Melde dich mit deinem Passkey an.'
})

async function login() {
	busy = true
	message = ''
	try {
		const result = await authClient.signIn.passkey()
		if (result?.error) throw new Error(result.error.message ?? 'Anmeldung fehlgeschlagen.')
		void goto('/dashboard')
	} catch (cause) {
		message = cause instanceof Error ? cause.message : 'Anmeldung fehlgeschlagen.'
	} finally {
		busy = false
	}
}
</script>

<svelte:head><title>Anmelden · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Willkommen zurück</h1>
	{#if message}
		<div class="alert">{message}</div>
	{/if}
	<p>Melde dich mit dem Passkey deines Aven‑Kontos an.</p>
	<button disabled={busy} onclick={login}>
		{busy ? 'Einen Moment …' : 'Mit Passkey anmelden'}
	</button>
</section>
