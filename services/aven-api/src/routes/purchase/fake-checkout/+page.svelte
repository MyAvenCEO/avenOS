<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { api } from '$lib/api.js'

let loading = $state(false)
let error = $state('')
const params = $derived({
	checkoutId: page.url.searchParams.get('checkoutId') ?? '',
	holdId: page.url.searchParams.get('holdId') ?? '',
	name: page.url.searchParams.get('name') ?? '',
	email: page.url.searchParams.get('email') ?? '',
	successUrl: page.url.searchParams.get('successUrl') ?? ''
})

async function pay() {
	loading = true
	error = ''
	try {
		const result = await api<{ paid: boolean; redirect: string }>('/billing/fake-pay', {
			method: 'POST',
			body: JSON.stringify(params)
		})
		void goto(result.redirect)
	} catch (e) {
		error = e instanceof Error ? e.message : 'Payment failed.'
	} finally {
		loading = false
	}
}
</script>

<svelte:head><title>Checkout</title></svelte:head>

<section class="panel auth">
	<h1>Checkout</h1>
	<p>{params.name} · {params.email}</p>
	{#if error}
		<div class="alert">{error}</div>
	{/if}
	<button disabled={loading || !params.holdId} onclick={pay}>
		{loading ? "Processing" : "Pay"}
	</button>
</section>
