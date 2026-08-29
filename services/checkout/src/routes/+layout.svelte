<script lang="ts">
import '../app.css'
import { legalHref } from '@myavenceo/aven-ceo'
import { page } from '$app/state'

let { children } = $props()
const legal = $derived(
	(
		[
			['impressum', 'Impressum'],
			['datenschutz', 'Datenschutz'],
			['widerruf', 'Widerrufsrecht']
		] as const
	).map(([slug, label]) => ({ label, href: legalHref(slug, { hostname: page.url.hostname }) }))
)
</script>
<header class="site">
	<a href="/" class="brand"><img src="/aven-logo.svg" alt=""><span>avenCEO</span></a>
	<nav><a href="https://aven.id/login">Account</a></nav>
</header>
<main class="site">{@render children()}</main>
<footer class="site">
	{#each legal as item}
		<a href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a>
	{/each}
</footer>
