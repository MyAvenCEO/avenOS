<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { goto } from '$app/navigation'
import { page } from '$app/state'

const initial = appRuntime.initial.login(page.url)
let busy = $state(initial.busy)
let message = $state(initial.message)

async function login() {
	busy = true
	message = ''
	try {
		await appRuntime.auth.signIn()
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
