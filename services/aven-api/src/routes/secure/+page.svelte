<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount } from 'svelte'
import { page } from '$app/state'
import { greetingFor, tierFrom } from '$lib/tiers.js'
import type { NameAvailability, NameHoldResult } from '$lib/types.js'

const initial = appRuntime.initial.secureName(page.url)
let name = $state(initial.name)
let email = $state(initial.email)
let info = $state<NameAvailability | null>(initial.info)
let hold = $state<NameHoldResult | null>(initial.hold)
let loading = $state(initial.loading)
let error = $state(initial.error)

// Moved here from the marketing site's waitlist: how to address them, and the
// one question we actually read when handing out a wildcard invite.
let salutation = $state('')
let idea = $state('')
const tier = $derived(tierFrom(page.url))
const greeting = $derived(greetingFor(tier))

onMount(async () => {
	info = await appRuntime.names.loadInfo(name, info)
})

async function secure() {
	loading = true
	error = ''
	try {
		hold = await appRuntime.names.hold(name, email, {
			tier: tier ?? undefined,
			salutation: salutation.trim() || undefined,
			idea: idea.trim() || undefined
		})
	} catch (e) {
		error = e instanceof Error ? e.message : 'Request failed.'
	} finally {
		loading = false
	}
}
</script>

<svelte:head><title>avenID sichern · avenCEO</title></svelte:head>

{#if hold}
	<section class="panel auth">
		<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
		<h1>Du bist auf der Liste</h1>
		<div class="code">
			<p class="eyebrow">Reserviert</p>
			<p class="digits">{hold.name}.aven.ceo</p>
		</div>
		<p>
			Wir haben dir den Link an <strong>{email}</strong> geschickt. Er gilt bis
			{new Date(hold.expiresAt).toLocaleString('de-DE')}.
		</p>
		<p class="fine">Wir melden uns per Mail, sobald du dran bist — und sonst nicht.</p>
	</section>
{:else}
	<section class="panel auth">
		<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
		<h1>{greeting ? `${greeting.name} sichern` : 'avenID sichern'}</h1>
		<div class="code">
			<p class="eyebrow">Dein Name</p>
			<p class="digits">{name}.aven.ceo</p>
		</div>
		<p>{info?.priceEur ?? 30} € einmalig, zzgl. USt.</p>
		{#if info && !info.available}
			<div class="alert">Dieser Name ist nicht mehr frei. <a href="/">Anderen wählen</a></div>
		{:else}
			<label
				>E‑Mail<input
					bind:value={email}
					type="email"
					autocomplete="email"
					placeholder="du@beispiel.de"
				></label
			>
			<label
				>Wie dürfen wir dich nennen?<input
					bind:value={salutation}
					maxlength="120"
					autocomplete="name"
					placeholder="z. B. Samuel"
				></label
			>
			<label
				>Was willst du bauen — und warum?<textarea
					bind:value={idea}
					rows="4"
					maxlength="2000"
					placeholder="Ich will …"
				></textarea></label
			>
			<p class="fine">
				Ein paar Sätze reichen. Wir vergeben <strong>Wildcard‑Einladungen</strong> an die Ideen, die
				uns umhauen — unabhängig vom Platz in der Warteliste.
			</p>
			{#if error}
				<div class="alert">{error}</div>
			{/if}
			<button disabled={loading || !email || !name} onclick={secure}>
				{loading ? 'Einen Moment …' : 'Platz sichern'}
			</button>
			<p class="fine">
				Mit Abschluss erklärst du dich einverstanden, dass wir dich anschreiben, sobald du dran
				bist. Keine Newsletter, kein Weiterverkauf.
			</p>
		{/if}
	</section>
{/if}
