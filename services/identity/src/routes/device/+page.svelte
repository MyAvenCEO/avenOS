<script lang="ts">
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'

let busy = $state(false)
let approved = $state(false)
let message = $state('')
const session = authClient.useSession()
const code = $derived(page.url.searchParams.get('user_code') ?? '')
const displayCode = $derived(code.replaceAll('-', '').replace(/(.{4})(?=.)/g, '$1-'))
const authenticated = $derived(Boolean($session.data))
const heading = $derived(
	!code
		? 'This connection link is incomplete'
		: approved
			? 'Device connected'
			: authenticated
				? 'Authorize this device'
				: 'Sign in and connect avenOS'
)
const description = $derived(
	!code
		? 'Open the sign-in link from avenOS again to receive a new device code.'
		: approved
			? 'You can close this page and return to avenOS.'
			: authenticated
				? 'Confirm the connection to give the app access to your Aven account.'
				: 'Use your Aven account passkey. You will confirm the app in the next step.'
)
async function login() {
	busy = true
	const result = await authClient.signIn.passkey()
	if (result?.error) message = result.error.message ?? 'Sign-in failed.'
	busy = false
}
async function approve() {
	busy = true
	message = ''
	try {
		const cleanCode = code.replaceAll('-', '')
		const claim = await fetch(`/api/auth/device?user_code=${encodeURIComponent(cleanCode)}`, {
			credentials: 'same-origin'
		})
		if (!claim.ok) {
			const body = (await claim.json().catch(() => null)) as { error_description?: string } | null
			throw new Error(body?.error_description ?? 'Could not claim this device code.')
		}
		const response = await fetch('/api/auth/device/approve', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ userCode: cleanCode })
		})
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as {
				error_description?: string
			} | null
			throw new Error(body?.error_description ?? 'Device authorization failed.')
		}
		approved = true
	} catch (cause) {
		message = cause instanceof Error ? cause.message : 'Device authorization failed.'
	} finally {
		busy = false
	}
}
</script>
<svelte:head><title>Authorize device · aven.id</title></svelte:head>
<section class="device-flow" aria-live="polite">
	<div class:success={approved} class:error={!code || Boolean(message)} class="device-flow__icon">
		{#if approved}
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="m5 12.5 4.25 4.25L19 7" />
			</svg>
		{:else if !code}
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 8v5M12 17h.01" />
				<circle cx="12" cy="12" r="9" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="5" y="10" width="14" height="10" rx="2" />
				<path d="M8 10V7a4 4 0 0 1 8 0v3" />
			</svg>
		{/if}
	</div>

	<p class="device-flow__eyebrow">Secure app connection</p>
	<h1>{heading}</h1>
	<p class="device-flow__description">{description}</p>

	{#if displayCode}
		<div class="device-flow__code">
			<span>Code: {code}</span>
			<strong>{displayCode}</strong>
		</div>
	{/if}
	{#if message}
		<div class="alert" role="alert">{message}</div>
	{/if}
	{#if !approved && authenticated}
		<button disabled={busy || !code} onclick={approve}>
			{busy ? 'Authorizing…' : 'Authorize'}
		</button>
	{:else if !approved && code}
		<button disabled={busy} onclick={login}>
			{busy ? 'Opening passkeys…' : 'Continue with passkey'}
		</button>
	{/if}

	<div class="device-flow__trust">
		<span></span>
		Securely connected through aven.id
	</div>
</section>
