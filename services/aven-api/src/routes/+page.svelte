<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { NameAvailability } from '$lib/types.js'

const initial = appRuntime.initial.nameSearch(page.url)
let name = $state(initial.name)
let busy = $state(initial.busy)
let result = $state<NameAvailability | null>(initial.result)
let error = $state(initial.error)

async function check() {
	busy = true
	result = null
	error = ''
	try {
		result = await appRuntime.names.check(name)
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Check failed.'
	} finally {
		busy = false
	}
}

function continueToCheckout() {
	if (result) void goto(`/secure?name=${encodeURIComponent(result.name)}`)
}
</script>

<svelte:head><title>avenID sichern · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Sichere dir deine avenID</h1>
	<p>Wie eine Domain — aber für deinen Aven. Jeden Namen gibt es genau einmal.</p>
	<form onsubmit={(event) => { event.preventDefault(); void check(); }}>
		<label
			>Dein Name<input
				bind:value={name}
				maxlength="32"
				autocomplete="off"
				placeholder="maia"
			></label
		>
		<button disabled={busy || name.trim().length < 3}>
			{busy ? 'Wird geprüft …' : 'Verfügbarkeit prüfen'}
		</button>
	</form>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	{#if result}
		{#if result.available}
			<div class="code">
				<p class="eyebrow">Frei</p>
				<p class="digits">{result.name}.aven.ceo</p>
			</div>
			<p>{result.priceEur} € einmalig, zzgl. USt.</p>
			<button onclick={continueToCheckout}>Weiter</button>
		{:else}
			<div class="alert">Dieser Name ist schon vergeben. Probier einen anderen.</div>
		{/if}
	{/if}
</section>
