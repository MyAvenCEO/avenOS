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

<!-- The passkey-linking card's shape: mark, title, lede, then the subject of
     the screen in a `.well` — there the name being linked, here the name being
     bought. The step rail shows the two stages of the confirmation. -->
<section class="panel stack stack-center">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>Zahlung abgeschlossen</h1>
	<p>Danke — der Kauf ist bei uns angekommen.</p>
	{#if name}
		<div class="well">
			<p class="eyebrow">Gekaufter Name</p>
			<p class="digits">{name}</p>
		</div>
	{/if}
	<div class="steps">
		<!-- The rail's filled state is `.step.done` in app.css; `step-done`
		     never matched, so the second stage stayed grey even once the
		     confirmation had landed. -->
		<span class="step done"></span>
		<span class="step" class:done={state !== 'confirming'}></span>
	</div>
	{#if state === 'confirming'}
		<p class="meta">Wird bestätigt …</p>
	{:else}
		<p class="meta">Sieh in deinem Postfach nach — die Bestätigung ist unterwegs.</p>
	{/if}

	<!-- What happens next. Buying the name is the beginning of the queue, not
	     the end of the purchase, and the page used to stop at "Zahlung
	     abgeschlossen" — leaving the one open question (und jetzt?)
	     unanswered. Deliberately no download link during the alpha: the app
	     comes with the invitation, and offering it here would invite a buyer
	     to install something they cannot yet sign into. -->
	<div class="well">
		<p class="eyebrow">Wie es weitergeht</p>
		<ol class="next">
			<li>
				Dein Name <strong>{name || 'dein Name'}.aven.ceo</strong> ist ab sofort für dich reserviert.
			</li>
			<li>
				Wir laden der Reihe nach ein. Wenn du dran bist, bekommst du deine
				<strong>Einladung per Mail</strong>
				— mit allem, was du für den Start brauchst.
			</li>
			<li>Damit richtest du deine erste avenCEO‑Instanz ein und nimmst sie in Betrieb.</li>
		</ol>
	</div>
	<p class="fine">
		Sieh also in den nächsten Tagen ins Postfach — auch im Spam‑Ordner, falls nichts ankommt. Du
		musst hier nichts weiter tun: Die Einladung kommt zu dir, nicht du zu ihr.
	</p>
</section>

<style>
/* The three stages, numbered because they happen in this order. Local to the
   page: nothing else in the funnel lists steps as prose. */
.next {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin: 0;
	padding-left: 1.1rem;
	text-align: left;
	font-size: 0.8125rem;
	line-height: 1.55;
}

.next li::marker {
	color: var(--quiet);
}
</style>
