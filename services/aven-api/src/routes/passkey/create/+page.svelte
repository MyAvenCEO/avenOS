<script lang="ts">
import { goto } from '$app/navigation'
import { api } from '$lib/api.js'
import { authClient } from '$lib/auth-client.js'

let name = $state('')
let busy = $state(false)
let error = $state('')

async function create() {
	busy = true
	error = ''
	try {
		if (!window.PublicKeyCredential) throw new Error('Passkeys unavailable.')
		const result = await authClient.passkey.addPasskey({
			name: name.trim() || undefined,
			extensions: { prf: {} } as never,
			returnWebAuthnResponse: true
		})
		if (result?.error) throw new Error(result.error.message ?? 'Passkey creation failed.')
		const extensions = (
			'webauthn' in result ? result.webauthn.clientExtensionResults : undefined
		) as { prf?: { enabled?: boolean } } | undefined
		const prf = extensions?.prf as { enabled?: boolean } | undefined
		const data = result?.data as Record<string, unknown> | undefined
		await api('/passkeys', {
			method: 'POST',
			body: JSON.stringify({
				credentialId: typeof data?.id === 'string' ? data.id : undefined,
				prfEnabled: prf?.enabled === true
			})
		})
		void goto('/dashboard')
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Passkey creation failed.'
	} finally {
		busy = false
	}
}
</script>

<svelte:head><title>Passkey anlegen · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Passkey anlegen</h1>
	<p>Ein Passkey ersetzt dein Passwort — er bleibt auf deinem Gerät.</p>
	<label>Name des Passkeys<input bind:value={name} maxlength="64"></label>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	<button disabled={busy} onclick={create}>{busy ? 'Einen Moment …' : 'Passkey anlegen'}</button>
</section>
