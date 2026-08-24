<script lang="ts">
import '../app.css'
import { appRuntime } from 'virtual:aven-app-runtime'
import BuildChrome from 'virtual:aven-build-chrome'
import { legalHref } from '@avenos/aven-brand'
import { goto } from '$app/navigation'
import { page } from '$app/state'

let { children } = $props()
const session = $derived(appRuntime.session(page.url))
// The website's Impressum, host-matched to where THIS app runs: localhost
// pairs with the local website, id.next.aven.ceo with next.aven.ceo, prod
// with aven.ceo — the brand lib derives it from our own hostname.
const impressum = $derived(legalHref('impressum', { hostname: page.url.hostname }))
async function logout() {
	await appRuntime.auth.signOut()
	void goto('/')
}
</script>

<BuildChrome />
<header class="site">
	<a href="/" class="brand">
		<img src="/aven-logo.svg" alt="">
		<span>avenCEO</span>
	</a>
	<nav>
		{#if $session.authenticated}
			<a href="/dashboard">Dashboard</a>
			<button class="link" onclick={logout}>Abmelden</button>
		{:else}
			<a href="/login">Anmelden</a>
		{/if}
	</nav>
</header>
<main class="site">{@render children()}</main>
<footer class="site">
	<a href={impressum} target="_blank" rel="noopener noreferrer">Impressum</a>
</footer>
