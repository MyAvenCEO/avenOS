<script lang="ts">
import { goto } from '$app/navigation'
import { api } from '$lib/api.js'
import type { NameAvailability } from '$lib/types.js'

let name = $state('')
let busy = $state(false)
let result = $state<NameAvailability | null>(null)
let error = $state('')

async function check() {
	busy = true
	result = null
	error = ''
	try {
		result = await api<NameAvailability>(
			`/names/check?name=${encodeURIComponent(name.trim().toLowerCase())}`
		)
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'Check failed.'
	} finally {
		busy = false
	}
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
			<button onclick={() => goto(`/secure?name=${encodeURIComponent(result!.name)}`)}>
				Weiter
			</button>
		{:else}
			<div class="alert">Dieser Name ist schon vergeben. Probier einen anderen.</div>
		{/if}
	{/if}
</section>
