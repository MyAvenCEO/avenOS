<script lang="ts">
import { onMount } from 'svelte'
import { page } from '$app/state'
import { designerMode } from '$lib/designer.js'

const name = $derived(page.url.searchParams.get('name') ?? '')
let state = $state<'confirming' | 'fallback'>('confirming')

// Best case: nobody visits their inbox. The success redirect carries a
// one-time purchase token; the moment the payment webhook lands, redeeming
// it signs the buyer in and we go straight to the dashboard. The emailed
// access link stays as the fallback.
onMount(() => {
	if (designerMode) {
		state = 'fallback'
		return
	}
	const token = page.url.searchParams.get('pt')
	const deadline = Date.now() + 60_000
	const poll = async () => {
		if (!token || Date.now() > deadline) {
			state = 'fallback'
			return
		}
		try {
			const response = await fetch('/api/auth/sign-in/purchase-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token })
			})
			if (response.ok) {
				window.location.assign('/dashboard')
				return
			}
		} catch {
			/* keep polling until the deadline */
		}
		setTimeout(() => void poll(), 1500)
	}
	void poll()
})
</script>

<svelte:head><title>Payment complete</title></svelte:head>

<section class="panel">
	<h1>Payment complete</h1>
	{#if name}
		<p>{name}</p>
	{/if}
	{#if state === "confirming"}
		<p>Confirming</p>
	{:else}
		<p>Check email</p>
	{/if}
</section>
