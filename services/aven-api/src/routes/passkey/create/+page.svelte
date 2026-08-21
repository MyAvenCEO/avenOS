<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { appRuntime } from 'virtual:aven-app-runtime'

const initial = appRuntime.initial.passkey(page.url)
let name = $state(initial.name)
let busy = $state(initial.busy)
let error = $state(initial.error)
let firefoxLinux = $state(false)

onMount(() => {
	firefoxLinux = appRuntime.auth.passkeyWarning(page.url)
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

<svelte:head><title>Create passkey</title></svelte:head>
<section class="panel auth">
	<h1>Create passkey</h1>
	<label>Passkey name<input bind:value={name} maxlength="64"></label>
	{#if firefoxLinux}
		<div class="alert">
			Firefox on Linux has no built-in platform passkey provider. Connect a FIDO2 security key or
			use a passkey-provider extension. Otherwise, open the original setup link on a browser or
			device that has one.
		</div>
	{/if}
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	<button disabled={busy} onclick={create}>{busy ? "Waiting" : "Create passkey"}</button>
</section>
