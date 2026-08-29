<script lang="ts">
import { page } from '$app/state'

const name = $derived(page.url.searchParams.get('name') ?? '')
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
		<span class="step step-done"></span>
		<span class="step step-done"></span>
	</div>
	<p class="meta">
		Sieh in deinem Postfach nach — aven.id sendet dir den sicheren Link zu deinem neuen Konto.
	</p>
</section>
