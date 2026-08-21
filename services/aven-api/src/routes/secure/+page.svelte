<script lang="ts">
import { onMount } from 'svelte'
import { page } from '$app/state'
import { appRuntime } from 'virtual:aven-app-runtime'
import type { NameAvailability, NameHoldResult } from '$lib/types.js'

const initial = appRuntime.initial.secureName(page.url)
let name = $state(initial.name)
let email = $state(initial.email)
let info = $state<NameAvailability | null>(initial.info)
let hold = $state<NameHoldResult | null>(initial.hold)
let loading = $state(initial.loading)
let error = $state(initial.error)

onMount(async () => {
	info = await appRuntime.names.loadInfo(name, info)
})

async function secure() {
	loading = true
	error = ''
	try {
		hold = await appRuntime.names.hold(name, email)
	} catch (e) {
		error = e instanceof Error ? e.message : 'Request failed.'
	} finally {
		loading = false
	}
}
</script>

<svelte:head><title>Checkout link</title></svelte:head>

{#if hold}
	<section class="panel auth">
		<h1>Checkout link sent</h1>
		<p>{hold.name} · {email}</p>
		<p>Expires: {new Date(hold.expiresAt).toLocaleString()}</p>
	</section>
{:else}
	<section class="panel auth">
		<h1>Checkout link</h1>
		<p>{name} · {info?.priceEur ?? 25} €</p>
		{#if info && !info.available}
			<div class="alert">Unavailable. <a href="/">Back</a></div>
		{:else}
			<label
				>Email<input
					bind:value={email}
					type="email"
					autocomplete="email"
					placeholder="you@example.com"
				></label
			>
			{#if error}
				<div class="alert">{error}</div>
			{/if}
			<button disabled={loading || !email || !name} onclick={secure}>
				{loading ? "Sending" : "Send checkout link"}
			</button>
		{/if}
	</section>
{/if}
