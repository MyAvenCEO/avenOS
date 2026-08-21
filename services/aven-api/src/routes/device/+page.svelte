<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { page } from '$app/state'

const session = appRuntime.session(page.url)
const userCode = $derived(page.url.searchParams.get('user_code')?.replaceAll('-', '') ?? '')
const displayCode = $derived(userCode.replace(/(.{4})(?=.)/g, '$1-'))
const initial = appRuntime.initial.device(page.url)
let signedIn = $state(initial.signedIn)
let busy = $state(initial.busy)
let approved = $state(initial.approved)
let message = $state(initial.message)
const authenticated = $derived($session.authenticated || signedIn)

async function login() {
	busy = true
	message = ''
	try {
		await appRuntime.auth.signIn()
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
		await appRuntime.device.approve(userCode)
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
