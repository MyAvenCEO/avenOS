<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { appRuntime } from 'virtual:aven-app-runtime'

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
		message = cause instanceof Error ? cause.message : 'Login failed.'
	} finally {
		busy = false
	}
}
</script>

<svelte:head><title>Login</title></svelte:head>
<section class="panel auth">
	<h1>Login</h1>
	{#if message}
		<div class="alert">{message}</div>
	{/if}
	<button disabled={busy} onclick={login}>{busy ? "Waiting" : "Sign in with passkey"}</button>
	<p>Email login works until a passkey is created.</p>
</section>
