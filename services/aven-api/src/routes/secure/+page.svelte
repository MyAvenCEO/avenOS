<script lang="ts">
import { onMount } from 'svelte'
import { page } from '$app/state'
import { api } from '$lib/api.js'
import { createProofOfWorkHeader } from '$lib/proof-of-work.js'
import type { NameAvailability, NameHoldResult } from '$lib/types.js'

let name = $state('')
let email = $state('')
let info = $state<NameAvailability | null>(null)
let hold = $state<NameHoldResult | null>(null)
let loading = $state(false)
let error = $state('')

onMount(async () => {
	name = (page.url.searchParams.get('name') ?? '').toLowerCase()
	if (name)
		info = await api<NameAvailability>(`/names/check?name=${encodeURIComponent(name)}`).catch(
			() => null
		)
})

async function secure() {
	loading = true
	error = ''
	try {
		const headers = await createProofOfWorkHeader('secure-name')
		const result = await api<{ hold: NameHoldResult }>('/names/hold', {
			method: 'POST',
			headers,
			body: JSON.stringify({ name, email })
		})
		hold = result.hold
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
