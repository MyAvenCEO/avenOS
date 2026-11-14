<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'
import { LOGIN_RETURN_PARAM, safeReturnPath } from '$lib/return-path.js'

let busy = $state(false)
let message = $state('')
async function login() {
	busy = true
	message = ''
	try {
		const result = await authClient.signIn.passkey()
		if (result?.error) throw new Error(result.error.message ?? 'Sign-in failed.')
		// A pending OIDC authorization resumes as a full navigation so the server can
		// redirect onward to the registered client; everything else goes to the dashboard.
		const target = safeReturnPath(page.url.searchParams.get(LOGIN_RETURN_PARAM), page.url.origin)
		if (target) window.location.assign(target)
		else await goto('/dashboard')
	} catch (error) {
		message = error instanceof Error ? error.message : 'Sign-in failed.'
	} finally {
		busy = false
	}
}
</script>
<svelte:head><title>Sign in · aven.id</title></svelte:head>
<section class="flow-card">
	<div class="flow-card-crest">
		<img src="/aven-logo.svg" alt="" width="56" height="56">
	</div>
	<h1 class="flow-card-heading">Sign in</h1>
	<p class="flow-card-description">Use a passkey registered to your Aven account.</p>
	{#if message}
		<div class="flow-card-alert" role="alert">{message}</div>
	{/if}
	<div class="flow-card-actions">
		<button class="btn btn--primary" disabled={busy} onclick={login}>
			{busy ? 'Opening passkeys…' : 'Continue with passkey'}
		</button>
	</div>
</section>
