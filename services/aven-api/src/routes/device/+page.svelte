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
const heading = $derived(
	!userCode
		? 'Dieser Verbindungslink ist unvollständig'
		: approved
			? 'avenOS ist verbunden'
			: authenticated
				? 'Diese avenOS-App verbinden?'
				: 'Anmelden und avenOS verbinden'
)
const description = $derived(
	!userCode
		? 'Öffne den Anmeldelink aus avenOS erneut, um einen neuen Gerätecode zu erhalten.'
		: approved
			? 'Du kannst diese Seite schließen und zu avenOS zurückkehren.'
			: authenticated
				? 'Bestätige die Verbindung, um der App Zugriff auf dein Aven-Konto zu geben.'
				: 'Verwende den Passkey deines Aven-Kontos. Im nächsten Schritt bestätigst du die App.'
)

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

<svelte:head><title>avenOS verbinden</title></svelte:head>
<section class="device-flow" aria-live="polite">
	<div
		class:success={approved}
		class:error={!userCode || Boolean(message)}
		class="device-flow__icon"
	>
		{#if approved}
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="m5 12.5 4.25 4.25L19 7" />
			</svg>
		{:else if !userCode}
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

	<p class="device-flow__eyebrow">Sichere App-Verbindung</p>
	<h1>{heading}</h1>
	<p class="device-flow__description">{description}</p>

	{#if displayCode}
		<div class="device-flow__code">
			<span>Gerätecode</span>
			<strong>{displayCode}</strong>
		</div>
	{/if}
	{#if message}
		<div class="alert" role="alert">{message}</div>
	{/if}
	{#if userCode && !approved && authenticated}
		<button disabled={busy || !userCode} onclick={approve}>
			{busy ? 'Wird verbunden …' : 'avenOS verbinden'}
		</button>
	{:else if userCode && !approved}
		<button disabled={busy || !userCode} onclick={login}>
			{busy ? 'Passkey wird geöffnet …' : 'Mit Passkey fortfahren'}
		</button>
	{/if}

	<div class="device-flow__trust">
		<span></span>
		Sicher verbunden über id.next.aven.ceo
	</div>
</section>
