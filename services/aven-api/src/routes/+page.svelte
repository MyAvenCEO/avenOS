<script lang="ts">
import { goto } from '$app/navigation'
import { api } from '$lib/api.js'
import { designerMode } from '$lib/designer.js'
import type { NameAvailability } from '$lib/types.js'

let name = $state(designerMode ? 'aurora' : '')
let busy = $state(false)
let result = $state<NameAvailability | null>(
	designerMode
		? { name: 'aurora', available: true, priceEur: 25, reservationMinutes: 15 }
		: null
)
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

<svelte:head><title>Check name</title></svelte:head>
<section class="panel auth">
	<h1>Check name</h1>
	<form onsubmit={(event) => { event.preventDefault(); void check(); }}>
		<label>Name<input bind:value={name} maxlength="32" autocomplete="off"></label>
		<button disabled={busy || name.trim().length < 3}>{busy ? "Checking" : "Check"}</button>
	</form>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	{#if result}
		{#if result.available}
			<p>{result.name} · {result.priceEur} €</p>
			<button onclick={() => goto(`/secure?name=${encodeURIComponent(result!.name)}`)}>
				Continue
			</button>
		{:else}
			<p>Unavailable</p>
		{/if}
	{/if}
</section>
