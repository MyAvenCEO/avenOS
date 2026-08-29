<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { greetingFor, tierFrom } from '$lib/tiers.js'
import type { NameAvailability } from '$lib/types.js'

const initial = appRuntime.initial.nameSearch(page.url)
let name = $state(initial.name)
let busy = $state(initial.busy)
let result = $state<NameAvailability | null>(initial.result)
let error = $state(initial.error)

/**
 * What the server will actually look up. Typing "Maia Andert!" asks about
 * `maia-andert`, so the field shows one thing and the check is honest about
 * the other — and the line under the input shows which.
 */
const slug = $derived(
	name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32)
)

/**
 * Availability answers while you type, not after you press something.
 *
 * Three things keep that from hammering the endpoint, which allows 30 checks
 * a minute per IP: a 400ms debounce, a guard that skips a slug we already
 * answered, and a sequence number so a slow early reply cannot overwrite a
 * newer one. `settled` starts at whatever the runtime handed us, so a
 * designer scenario is not immediately re-checked out from under itself.
 */
let settled = $state(initial.result ? initial.name : '')
let sequence = 0

$effect(() => {
	const candidate = slug
	if (candidate.length < 3) {
		result = null
		error = ''
		busy = false
		return
	}
	if (candidate === settled) return

	busy = true
	error = ''
	const ticket = ++sequence
	const timer = setTimeout(async () => {
		try {
			const answer = await appRuntime.names.check(candidate)
			if (ticket !== sequence) return
			result = answer
			settled = candidate
		} catch (cause) {
			if (ticket !== sequence) return
			result = null
			error = cause instanceof Error ? cause.message : 'Prüfung fehlgeschlagen.'
		} finally {
			if (ticket === sequence) busy = false
		}
	}, 400)

	return () => clearTimeout(timer)
})

// The tier rides along the whole way: it is how we know which button sent
// someone here, and it is what the hold records.
const tier = $derived(tierFrom(page.url))
const greeting = $derived(greetingFor(tier))

function continueToCheckout() {
	if (!result?.available) return
	const query = new URLSearchParams({ name: result.name })
	if (tier) query.set('tier', tier)
	void goto(`/secure?${query}`)
}
</script>

<svelte:head><title>avenNAME sichern · avenCEO</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Sichere dir deinen avenNAME</h1>
	{#if greeting}
		<p class="eyebrow">Warteliste · {greeting.name}</p>
		<p>{greeting.lead}</p>
	{:else}
		<p>Wie eine Domain — aber für deinen Aven. Jeden Namen gibt es genau einmal.</p>
	{/if}
	<!-- No check button: the answer arrives while you type. Enter goes straight
	     on when the name is free, so the keyboard path still works. -->
	<form
		onsubmit={(event) => {
			event.preventDefault()
			continueToCheckout()
		}}
	>
		<label
			>Dein Name<input
				bind:value={name}
				maxlength="32"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				placeholder="maia"
			></label
		>

		<!-- One line that always holds the answer, so nothing jumps as it changes. -->
		<p class="status" aria-live="polite">
			{#if slug.length === 0}
				<span class="fine">Wie eine Domain — dein Name, einmalig vergeben.</span>
			{:else if slug.length < 3}
				<span class="fine">Noch {3 - slug.length} Zeichen …</span>
			{:else if busy}
				<span class="fine">{slug}.aven.ceo wird geprüft …</span>
			{:else if error}
				<span class="taken">{error}</span>
			{:else if result?.available}
				<span class="free">✓ {result.name}.aven.ceo ist frei</span>
			{:else if result}
				<span class="taken">✕ {result.name}.aven.ceo ist schon vergeben</span>
			{:else}
				<span class="fine">{slug}.aven.ceo</span>
			{/if}
		</p>

		{#if result?.available}
			<p>{result.priceEur} € einmalig, zzgl. USt.</p>
			<button type="submit">Weiter</button>
		{/if}
	</form>
</section>
