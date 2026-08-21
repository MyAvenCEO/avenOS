<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { goto } from '$app/navigation'
import { page } from '$app/state'

const initial = appRuntime.initial.payment(page.url)
let loading = $state(initial.busy)
let error = $state(initial.error)
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
		const result = await appRuntime.billing.pay(params)
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
