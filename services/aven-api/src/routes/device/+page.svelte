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

<svelte:head><title>avenOS verbinden</title></svelte:head>

<!-- This page renders INSIDE the desktop app's webview, so it is the login
     screen people actually see. It carries the brand rather than the
     service's default grey — styles are scoped here so the other aven-api
     pages keep the plain shell they were built with. -->
<section class="gate">
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

<style>
/* The brand tokens this page needs, spelled locally — aven-api has no
	   theme layer of its own and does not need one for a single screen. */
.gate {
	--ink: #1f2a3d;
	--linen: #f8f6ef;
	--porcelain: #fffdf7;
	--marine: #1e293b;
	--chalk: #f8fafc;
	--terracotta: #c15b40;
	--border: rgba(31, 42, 61, 0.14);

	display: grid;
	gap: 1rem;
	justify-items: center;
	width: min(100%, 26rem);
	margin: 3rem auto;
	padding: 2.5rem 2rem;
	border: 1px solid var(--border);
	border-radius: 1.5rem;
	background: var(--porcelain);
	box-shadow: 0 1px 3px rgba(30, 41, 59, 0.05);
	color: var(--ink);
	font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
	text-align: center;
}

:global(body:has(.gate)) {
	background: var(--linen, #f8f6ef);
}

.mark {
	width: 3.5rem;
	height: 3.5rem;
}

h1 {
	margin: 0;
	font-size: 1.25rem;
	font-weight: 600;
	letter-spacing: -0.015em;
}

.lead {
	max-width: 22rem;
	margin: 0;
	color: rgba(31, 42, 61, 0.6);
	font-size: 0.875rem;
	line-height: 1.6;
}

.code {
	width: 100%;
	padding: 1rem;
	border: 1px solid var(--border);
	border-radius: 0.75rem;
	background: #f6f3e8;
}

.eyebrow {
	margin: 0;
	color: rgba(31, 42, 61, 0.45);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.14em;
	text-transform: uppercase;
}

.digits {
	margin: 0.4rem 0 0;
	font-family: "JetBrains Mono", ui-monospace, monospace;
	font-size: 1.5rem;
	font-weight: 600;
	letter-spacing: 0.18em;
}

button.primary {
	min-height: 2.75rem;
	padding: 0 1.75rem;
	border: 0;
	border-radius: 9999px;
	background: var(--marine);
	color: var(--chalk);
	font: inherit;
	font-weight: 600;
	font-size: 0.875rem;
	cursor: pointer;
	transition: opacity 0.15s ease;
}

button.primary:hover:not(:disabled) {
	opacity: 0.9;
}

button.primary:disabled {
	cursor: default;
	opacity: 0.45;
}

.alert {
	width: 100%;
	padding: 0.75rem 1rem;
	border: 1px solid rgba(193, 91, 64, 0.35);
	border-radius: 0.75rem;
	background: rgba(193, 91, 64, 0.08);
	color: var(--terracotta);
	font-size: 0.8125rem;
	line-height: 1.5;
	text-align: left;
}
</style>
