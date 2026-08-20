<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'

let busy = $state(false)
let message = $state('')

onMount(() => {
	if (page.url.searchParams.get('access') === 'invalid')
		message = 'Link unavailable. Sign in with a passkey.'
})

async function login() {
	busy = true
	message = ''
	try {
		const result = await authClient.signIn.passkey()
		if (result?.error) throw new Error(result.error.message ?? 'Login failed.')
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
