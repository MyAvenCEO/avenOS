<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { PageData } from './$types.js'

let { data }: { data: PageData } = $props()
let checkoutFrame = $state<HTMLIFrameElement>()
const initial = appRuntime.initial.checkout(page.url)
let checkoutState = $state(initial.state)
let paymentError = $state(initial.error)
const creemEmbedOrigins = new Set([
	'https://creem.io',
	'https://checkout.creem.io',
	'https://www.creem.io'
])

const fakeParams = (() => {
	if (data.provider !== 'fake') return null
	const url = new URL(data.checkoutUrl)
	return {
		checkoutId: url.searchParams.get('checkoutId') ?? '',
		holdId: url.searchParams.get('holdId') ?? '',
		name: url.searchParams.get('name') ?? '',
		email: url.searchParams.get('email') ?? '',
		successUrl: url.searchParams.get('successUrl') ?? ''
	}
})()

async function payFake() {
	if (!fakeParams) return
	checkoutState = 'paying'
	paymentError = ''
	try {
		const result = await appRuntime.billing.pay(fakeParams)
		await goto(result.redirect)
	} catch (error) {
		paymentError = error instanceof Error ? error.message : 'Payment failed.'
		checkoutState = 'ready'
	}
}

onMount(() => {
	if (data.provider === 'fake') {
		if (checkoutState === 'loading') checkoutState = 'ready'
		return
	}

	const receiveCreemEvent = (event: MessageEvent) => {
		if (!creemEmbedOrigins.has(event.origin) || event.source !== checkoutFrame?.contentWindow)
			return
		const detail = event.data as { source?: string; type?: string; redirectUrl?: string } | null
		if (detail?.source !== 'creem-embed') return
		if (detail.type === 'ready') checkoutState = 'ready'
		if (detail.type !== 'completed') return

		checkoutState = 'confirming'
		if (!detail.redirectUrl) return
		const target = new URL(detail.redirectUrl, window.location.origin)
		// The iframe callback is UX-only; fulfilment still comes exclusively
		// from the verified webhook. Only follow our own minted success URL.
		if (target.origin === window.location.origin && target.pathname === '/purchase/success') {
			window.location.assign(target.toString())
		}
	}

	window.addEventListener('message', receiveCreemEvent)
	return () => window.removeEventListener('message', receiveCreemEvent)
})
</script>

<svelte:head><title>Checkout</title></svelte:head>

<section class="checkout-page">
	<!-- Which name is being paid for — the one fact the Creem embed cannot show. -->
	<p class="checkout-subject"><span>Du sicherst</span> {data.name}.aven.ceo</p>

	<div class="checkout-container">
		{#if fakeParams}
			<div class="mock-checkout">
				<h2>{data.name}</h2>
				{#if paymentError}
					<div class="alert">{paymentError}</div>
				{/if}
				<button disabled={checkoutState === "paying"} onclick={payFake}>
					{checkoutState === "paying" ? "Processing" : "Pay"}
				</button>
			</div>
		{:else}
			<p class="checkout-state" aria-live="polite">
				{checkoutState === "confirming" ? "Confirming" : checkoutState === "ready" ? "Ready" : "Loading"}
			</p>
			<iframe
				bind:this={checkoutFrame}
				src={data.checkoutUrl}
				title={`Checkout for ${data.name}`}
				allow="payment *; publickey-credentials-get *"
				referrerpolicy="same-origin"
			></iframe>
		{/if}
	</div>
</section>

<style>
/* One centred column: the Creem embed is the page. */
.checkout-page {
	display: grid;
	grid-template-columns: minmax(0, 40rem);
	justify-content: center;
	gap: 1rem;
}
.checkout-subject {
	margin: 0;
	font-size: 0.9375rem;
	text-align: center;
}
.checkout-subject span {
	color: var(--quiet);
}
.checkout-container {
	min-height: 36rem;
	padding: 1rem;
	border: 1px solid var(--border-soft);
	border-radius: 1.5rem;
	background: var(--porcelain);
}
.checkout-container iframe {
	display: block;
	width: 100%;
	height: 48rem;
	border: 0;
}
.checkout-state {
	margin-bottom: 1rem;
	text-align: center;
}
.mock-checkout {
	display: grid;
	align-content: center;
	gap: 1rem;
	min-height: 32rem;
	padding: 1rem;
}
.mock-checkout button {
	width: 100%;
}
@media (max-width: 900px) {
	.checkout-container {
		min-height: 0;
	}
}
</style>
