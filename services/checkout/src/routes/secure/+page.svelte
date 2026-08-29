<script lang="ts">
import { appRuntime } from 'virtual:aven-app-runtime'
import { onMount, tick } from 'svelte'
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

/**
 * One question per screen, the way the old waitlist asked them.
 *
 * A single form with four fields reads as paperwork; asked one at a time the
 * same questions read as a conversation, and each answer is a small
 * commitment that makes the next one likelier. The name was step 1 on the
 * page before this, so the counter starts at 2 and the bar shows all four.
 */
const TOTAL_STEPS = 4
let step = $state(1)

const emailOk = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

function next() {
	error = ''
	if (step === 1 && !emailOk) {
		error = 'Bitte gib eine gültige E‑Mail‑Adresse ein.'
		return
	}
	step += 1
}

function back() {
	error = ''
	step -= 1
}

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
		error =
			e instanceof Error ? e.message : 'Das hat nicht geklappt. Versuch es gleich noch einmal.'
	} finally {
		loading = false
	}
}

/**
 * Each step puts the cursor where the answer goes. Without this you land on a
 * question with the keyboard pointing nowhere and have to click the field —
 * three times across the flow.
 */
let panel = $state<HTMLElement | null>(null)

$effect(() => {
	// Both are read HERE so the effect tracks them: `step` to move focus on
	// every step, and `panel` because on first paint the binding is still null
	// and the effect must run again once it lands.
	void step
	// `info` too: it arrives from the server after first paint and re-renders
	// this block, which drops whatever focus we had just set.
	void info
	const host = panel
	if (!host) return
	// After paint, not just after tick: `loadInfo` resolves shortly after mount
	// and re-renders this block, which would drop a focus set any earlier.
	void tick().then(() => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				host
					.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
					?.focus({ preventScroll: true })
			})
		})
	})
})

function onKey(event: KeyboardEvent) {
	if (event.key !== 'Enter') return
	event.preventDefault()
	next()
}
</script>

<svelte:head><title>avenNAME sichern · avenCEO</title></svelte:head>

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
		<h1>{greeting ? `${greeting.name} sichern` : 'avenNAME sichern'}</h1>
		<div class="code">
			<p class="eyebrow">Dein Name</p>
			<p class="digits">{name}.aven.ceo</p>
		</div>
		<p>{info?.priceEur ?? 30} € einmalig, zzgl. USt.</p>

		{#if info && !info.available}
			<div class="alert">Dieser Name ist nicht mehr frei. <a href="/">Anderen wählen</a></div>
		{:else}
			<div class="steps" aria-hidden="true">
				{#each Array(TOTAL_STEPS) as _, i (i)}
					<span class="step {i <= step ? 'done' : ''}"></span>
				{/each}
			</div>
			<p class="eyebrow">Schritt {step + 1} von {TOTAL_STEPS}</p>

			<div class="field" bind:this={panel}>
				{#if step === 1}
					<label
						>E‑Mail<input
							bind:value={email}
							type="email"
							autocomplete="email"
							placeholder="du@beispiel.de"
							onkeydown={onKey}
						></label
					>
					<p class="fine">Hierhin schicken wir deinen Link — und sonst nichts.</p>
				{:else if step === 2}
					<label
						>Wie dürfen wir dich nennen?<input
							bind:value={salutation}
							maxlength="120"
							autocomplete="name"
							placeholder="z. B. Samuel"
							onkeydown={onKey}
						></label
					>
					<p class="fine">
						Damit wir dich anschreiben können wie ein Mensch, nicht wie ein Formular.
					</p>
				{:else}
					<label
						>Was wünschst du dir, dass {name} für dich tut?<textarea
							bind:value={idea}
							rows="5"
							maxlength="2000"
							placeholder="{name} soll …"
						></textarea></label
					>
					<p class="fine">
						Ein paar Sätze reichen. Wir vergeben <strong>Wildcard‑Einladungen</strong> an die Ideen,
						die uns umhauen — unabhängig vom Platz in der Warteliste.
					</p>
				{/if}
			</div>

			{#if error}
				<div class="alert">{error}</div>
			{/if}

			<div class="actions">
				{#if step > 1}
					<button class="ghost" type="button" onclick={back}>Zurück</button>
				{:else}
					<a class="ghost" href="/">Anderer Name</a>
				{/if}
				{#if step < 3}
					<button type="button" disabled={step === 1 && !emailOk} onclick={next}>Weiter</button>
				{:else}
					<button type="button" disabled={loading || !email || !name} onclick={secure}>
						{loading ? 'Einen Moment …' : idea.trim() ? 'Platz sichern' : 'Ohne Idee absenden'}
					</button>
				{/if}
			</div>

			<p class="fine">
				Mit Abschluss erklärst du dich einverstanden, dass wir dich anschreiben, sobald du dran
				bist. Keine Newsletter, kein Weiterverkauf.
			</p>
		{/if}
	</section>
{/if}
