<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { page } from '$app/state'

const name = $derived(page.url.searchParams.get('name') ?? '')
let state = $state<'confirming' | 'fallback'>('confirming')

// Best case: nobody visits their inbox. The success redirect carries a
// one-time purchase token; the moment the payment webhook lands, redeeming
// it signs the buyer in and we go straight to the dashboard. The emailed
// access link stays as the fallback.
onMount(() => {
	const token = page.url.searchParams.get('pt')
	const finish = async () => {
		if (await appRuntime.purchase.waitForSession(token ?? '', page.url)) {
			window.location.assign('/dashboard')
			return
		}
		state = 'fallback'
	}
	void finish()
})
</script>

<svelte:head><title>Payment complete</title></svelte:head>

<!-- The passkey-linking card's shape: mark, title, lede, then the subject of
     the screen in a `.well` — there the name being linked, here the name being
     bought. The step rail shows the two stages of the confirmation. -->
<section class="panel stack">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Zahlung abgeschlossen</h1>
	<p>Danke — der Kauf ist bei uns angekommen.</p>
	{#if name}
		<div class="well">
			<p class="eyebrow">Gekaufter Name</p>
			<p class="digits">{name}</p>
		</div>
	{/if}
	<div class="steps">
		<span class="step step-done"></span>
		<span class="step" class:step-done={state !== 'confirming'}></span>
	</div>
	{#if state === 'confirming'}
		<p class="meta">Wird bestätigt …</p>
	{:else}
		<p class="meta">Sieh in deinem Postfach nach — die Bestätigung ist unterwegs.</p>
	{/if}
</section>
