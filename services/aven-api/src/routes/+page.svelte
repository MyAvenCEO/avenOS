<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { appRuntime } from 'virtual:aven-app-runtime'
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
