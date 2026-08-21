<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'

const initial = appRuntime.initial.passkey(page.url)
let name = $state(initial.name)
let busy = $state(initial.busy)
let error = $state(initial.error)
let firefoxLinux = $state(false)

onMount(async () => {
	firefoxLinux = appRuntime.auth.passkeyWarning(page.url)
	// Name the passkey after the aven it unlocks, so nobody has to invent a
	// label for a thing they just named. Only ever fills an empty field.
	if (name.trim()) return
	try {
		const [own] = await appRuntime.names.mine()
		if (own && !name.trim()) name = own
	} catch {
		// A missing name is not worth an error here — the field stays empty.
	}
})

async function create() {
	busy = true
	error = ''
	try {
		await appRuntime.auth.createPasskey(name, firefoxLinux)
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
	{#if firefoxLinux}
		<div class="alert">
			Firefox unter Linux hat keinen eingebauten Passkey‑Anbieter. Nutze einen
			FIDO2‑Sicherheitsschlüssel oder eine Passkey‑Erweiterung — oder öffne den ursprünglichen Link
			auf einem Gerät, das einen hat.
		</div>
	{/if}
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	<button disabled={busy} onclick={create}>{busy ? 'Einen Moment …' : 'Passkey anlegen'}</button>
</section>
