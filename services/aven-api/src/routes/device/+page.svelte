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

<svelte:head><title>avenOS verbinden</title></svelte:head>

<!-- This page renders INSIDE the desktop app's webview, so it is the login
     screen people actually see. It carries the brand rather than the
     service's default grey — styles are scoped here so the other aven-api
     pages keep the plain shell they were built with. -->
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>avenOS verbinden</h1>

	{#if displayCode}
		<div class="code">
			<p class="eyebrow">Gerätecode</p>
			<p class="digits">{displayCode}</p>
		</div>
	{/if}

	{#if message}
		<div class="alert">{message}</div>
	{/if}

	{#if approved}
		<p class="lead">avenOS ist verbunden. Du kannst zurück in die App.</p>
	{:else if authenticated}
		<p class="lead">Bestätige dieses Gerät, um der avenOS‑App Zugriff auf dein Konto zu geben.</p>
		<button class="primary" disabled={busy || !userCode} onclick={approve}>
			{busy ? 'Einen Moment …' : 'avenOS verbinden'}
		</button>
	{:else}
		<p class="lead">Melde dich mit dem Passkey deines Aven‑Kontos an.</p>
		<button class="primary" disabled={busy || !userCode} onclick={login}>
			{busy ? 'Einen Moment …' : 'Mit Passkey anmelden'}
		</button>
	{/if}
</section>
