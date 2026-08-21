<script lang="ts">
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'

const session = authClient.useSession()
const userCode = $derived(page.url.searchParams.get('user_code')?.replaceAll('-', '') ?? '')
const displayCode = $derived(userCode.replace(/(.{4})(?=.)/g, '$1-'))
let signedIn = $state(false)
let busy = $state(false)
let approved = $state(false)
let message = $state('')
const authenticated = $derived(Boolean($session.data) || signedIn)

async function responseJson(response: Response): Promise<Record<string, unknown>> {
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
	if (!response.ok) {
		throw new Error(
			typeof body.message === 'string'
				? body.message
				: typeof body.error_description === 'string'
					? body.error_description
					: 'Device authorization failed.'
		)
	}
	return body
}

async function login() {
	busy = true
	message = ''
	try {
		const result = await authClient.signIn.passkey()
		if (result?.error) throw new Error(result.error.message ?? 'Login failed.')
		signedIn = true
	} catch (cause) {
		message = cause instanceof Error ? cause.message : 'Login failed.'
	} finally {
		busy = false
	}
}

async function approve() {
	busy = true
	message = ''
	try {
		if (!userCode) throw new Error('The device code is missing.')
		await responseJson(
			await fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
				credentials: 'same-origin'
			})
		)
		await responseJson(
			await fetch('/api/auth/device/approve', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ userCode })
			})
		)
		approved = true
	} catch (cause) {
		message = cause instanceof Error ? cause.message : 'Device authorization failed.'
	} finally {
		busy = false
	}
}
</script>

<svelte:head><title>Connect avenOS</title></svelte:head>
<section class="panel auth">
	<h1>Connect avenOS</h1>
	{#if displayCode}
		<p>Device code: <strong>{displayCode}</strong></p>
	{/if}
	{#if message}
		<div class="alert">{message}</div>
	{/if}
	{#if approved}
		<p>avenOS is connected. You can return to the app.</p>
	{:else if authenticated}
		<p>Approve this device to give the avenOS app access to your account.</p>
		<button disabled={busy || !userCode} onclick={approve}>
			{busy ? 'Waiting' : 'Connect avenOS'}
		</button>
	{:else}
		<p>Sign in with the passkey for your Aven account.</p>
		<button disabled={busy || !userCode} onclick={login}>
			{busy ? 'Waiting' : 'Sign in with passkey'}
		</button>
	{/if}
</section>
