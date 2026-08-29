<script lang="ts">
import '../app.css'
import { legalHref } from '@myavenceo/aven-ceo'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { authClient } from '$lib/auth-client.js'

let { children } = $props()
const session = authClient.useSession()
const legal = $derived(
	(
		[
			['impressum', 'Impressum'],
			['datenschutz', 'Datenschutz'],
			['social-media', 'Social-Media-Datenschutz'],
			['widerruf', 'Widerrufsrecht']
		] as const
	).map(([slug, label]) => ({ label, href: legalHref(slug, { hostname: page.url.hostname }) }))
)
async function signOut() {
	await authClient.signOut()
	await goto('/login')
}
</script>

<header class="site">
	<a href="/" class="brand"><img src="/aven-logo.svg" alt=""><span>avenCEO</span></a>
	<nav>
		{#if $session.data}
			<a href="/dashboard">Account</a>
			<button class="link" onclick={signOut}>Sign out</button>
		{:else}
			<a href="/login">Sign in</a>
		{/if}
	</nav>
</header>
<main class="site">{@render children()}</main>
<footer class="site">
	{#each legal as item (item.href)}
		<a href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a>
	{/each}
</footer>
