<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { greetingFor, tierFrom } from '$lib/tiers.js'
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

// The tier rides along the whole way: it is how we know which button sent
// someone here, and it is what the hold records.
const tier = $derived(tierFrom(page.url))
const greeting = $derived(greetingFor(tier))

function continueToCheckout() {
	if (!result) return
	const query = new URLSearchParams({ name: result.name })
	if (tier) query.set('tier', tier)
	void goto(`/secure?${query}`)
}
</script>

<svelte:head><title>avenID sichern · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Sichere dir deine avenID</h1>
	{#if greeting}
		<p class="eyebrow">Warteliste · {greeting.name}</p>
		<p>{greeting.lead}</p>
	{:else}
		<p>Wie eine Domain — aber für deinen Aven. Jeden Namen gibt es genau einmal.</p>
	{/if}
	<p class="fine">
		Wir sind noch in der Early Alpha — avenMAIA und avenTIN laufen gerade auf uns selbst: echte
		Posteingänge, echte Dokumente, echter Alltag. Wir schleifen, bis wir sagen können: das gibt dir
		nachweislich Zeit zurück.
	</p>
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
