<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import type { PageData } from './$types.js'

let { data }: { data: PageData } = $props()
const initial = appRuntime.initial.checkout(page.url)
let checkoutState = $state(initial.state)
let paymentError = $state(initial.error)
/** When Polar's embed never loads, the same checkout continues as a plain
 * redirect — the URL was minted server-side either way. */
let embedFailed = $state(false)
/** If the embed hasn't reported `loaded`, this is how long we wait before
 * offering the redirect instead. */
const EMBED_READY_TIMEOUT_MS = 8000

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

/** Launch Polar's embedded checkout over this page. It reports back through
 * its own message channel; the iframe callback is UX-only — fulfilment
 * still comes exclusively from the verified webhook. */
async function launchEmbed() {
	embedFailed = false
	checkoutState = 'loading'
	let loaded = false
	const fallback = setTimeout(() => {
		// No `loaded` from the embed: offer the plain redirect instead.
		if (!loaded) {
			embedFailed = true
			checkoutState = 'ready'
		}
	}, EMBED_READY_TIMEOUT_MS)
	try {
		const { PolarEmbedCheckout } = await import('@polar-sh/checkout/embed')
		const embed = await PolarEmbedCheckout.create(data.checkoutUrl, { theme: 'light' })
		loaded = true
		clearTimeout(fallback)
		checkoutState = 'ready'
		embed.addEventListener('confirmed', () => {
			checkoutState = 'confirming'
		})
		embed.addEventListener('success', (event) => {
			// Only follow our own minted success URL, and follow it ourselves.
			event.preventDefault()
			checkoutState = 'confirming'
			const target = new URL(event.detail.successURL, window.location.origin)
			if (target.origin === window.location.origin && target.pathname === '/purchase/success') {
				embed.close()
				window.location.assign(target.toString())
			}
		})
		embed.addEventListener('close', () => {
			// Closed without paying: the page stays, the checkout can reopen.
			if (checkoutState !== 'confirming') checkoutState = 'ready'
		})
	} catch {
		clearTimeout(fallback)
		embedFailed = true
		checkoutState = 'ready'
	}
}

onMount(() => {
	if (data.provider === 'fake') {
		if (checkoutState === 'loading') checkoutState = 'ready'
		return
	}
	// Designer scenarios seed a non-loading state — render it without an embed.
	if (initial.state === 'loading') void launchEmbed()
})
</script>

<svelte:head><title>Checkout</title></svelte:head>

<section class="checkout-page">
	<!-- Which name is being paid for — the one fact the Polar embed cannot show. -->
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
			<div class="polar-checkout">
				<p class="checkout-state" aria-live="polite">
					{checkoutState === "confirming" ? "Confirming" : checkoutState === "ready" ? "Ready" : "Loading"}
				</p>
				{#if embedFailed}
					<!-- The embed never loaded: same checkout, plain redirect. -->
					<a class="checkout-link" href={data.checkoutUrl}>Zum Checkout</a>
				{:else if checkoutState === "ready"}
					<button type="button" onclick={launchEmbed}>Checkout öffnen</button>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
/* One centred column: the Polar embed overlays the page. */
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
.checkout-state {
	margin-bottom: 1rem;
	text-align: center;
}
.polar-checkout {
	display: grid;
	align-content: center;
	gap: 1rem;
	min-height: 32rem;
	padding: 1rem;
}
.polar-checkout button,
.checkout-link {
	width: 100%;
}
.checkout-link {
	display: block;
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
