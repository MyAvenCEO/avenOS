<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { authClient } from '$lib/auth-client.js'
import type { PasskeySummary } from '$lib/types.js'

const session = authClient.useSession()
let passkeys = $state<PasskeySummary[]>([])
let requirePrf = $state(false)
let busy = $state(false)
let error = $state('')
async function load() {
	const response = await fetch('/api/passkeys', { credentials: 'same-origin' })
	if (response.status === 401) {
		await goto('/login')
		return
	}
	if (!response.ok) throw new Error('Could not load passkeys.')
	const result = (await response.json()) as { passkeys: PasskeySummary[]; requirePrf: boolean }
	passkeys = result.passkeys
	requirePrf = result.requirePrf
}
onMount(() => {
	void load().catch((cause) => {
		error = cause instanceof Error ? cause.message : 'Could not load passkeys.'
	})
})
async function addPasskey() {
	busy = true
	error = ''
	try {
		const result = await authClient.passkey.addPasskey({
			name: `Passkey ${passkeys.length + 1}`,
			returnWebAuthnResponse: true,
			...(requirePrf ? { extensions: { prf: {} } as never } : {})
		})
		if (result?.error) throw new Error(result.error.message ?? 'Passkey registration failed.')
		const extension = ('webauthn' in result ? result.webauthn.clientExtensionResults : undefined) as
			| { prf?: { enabled?: boolean } }
			| undefined
		const response = await fetch('/api/passkeys', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				credentialId: result.data?.credentialID,
				prfEnabled: extension?.prf?.enabled === true
			})
		})
		if (!response.ok)
			throw new Error(
				((await response.json()) as { message?: string }).message ??
					'Could not finalize passkey registration.'
			)
		await load()
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Passkey registration failed.'
	} finally {
		busy = false
	}
}
</script>
<svelte:head><title>Your account · aven.id</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Your account</h1>
	<p class="account-email">{$session.data?.user.email ?? 'Loading…'}</p>
	<h2 class="passkey-heading">Passkeys</h2>
	{#if error}
		<div class="alert" role="alert">{error}</div>
	{/if}
	{#if passkeys.length}
		<ul class="passkeys">
			{#each passkeys as passkey (passkey.id)}
				<li>
					<span
						><strong>{passkey.name || 'Passkey'}</strong><br>
						<span class="muted"
							>{passkey.device_type}{passkey.backed_up ? ' · synced' : ''}</span
						></span
					><span class="muted">{new Date(passkey.created_at).toLocaleDateString()}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="well"><p>No passkey has been registered yet.</p></div>
	{/if}
	<div class="actions">
		<button disabled={busy} onclick={addPasskey}>
			{busy ? 'Adding…' : passkeys.length ? 'Add another passkey' : 'Add passkey'}
		</button>
	</div>
</section>
