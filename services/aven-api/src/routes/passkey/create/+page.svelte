<script lang="ts">
import { goto } from '$app/navigation'
import { api } from '$lib/api.js'
import { authClient } from '$lib/auth-client.js'
import { designerMode } from '$lib/designer.js'

let name = $state(designerMode ? 'MacBook Touch ID' : '')
let busy = $state(false)
let error = $state('')

async function create() {
	busy = true
	error = ''
	try {
		if (designerMode) {
			await goto('/dashboard')
			return
		}
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

<svelte:head><title>Create passkey</title></svelte:head>
<section class="panel auth">
	<h1>Create passkey</h1>
	<label>Passkey name<input bind:value={name} maxlength="64"></label>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	<button disabled={busy} onclick={create}>{busy ? "Waiting" : "Create passkey"}</button>
</section>
