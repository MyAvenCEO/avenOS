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
