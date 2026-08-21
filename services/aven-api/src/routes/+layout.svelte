<script lang="ts">
import '../app.css'
import { appRuntime } from 'virtual:aven-app-runtime'
import BuildChrome from 'virtual:aven-build-chrome'
import { goto } from '$app/navigation'
import { page } from '$app/state'

let { children } = $props()
const session = $derived(appRuntime.session(page.url))
async function logout() {
	await appRuntime.auth.signOut()
	void goto('/')
}
</script>

<BuildChrome />
<header class="site">
	<a href="/" class="brand">Aven</a>
	<nav>
		{#if $session.authenticated}
			<a href="/dashboard">Dashboard</a>
			<button class="link" onclick={logout}>Log out</button>
		{:else}
			<a href="/login">Login</a>
		{/if}
	</nav>
</header>
<main class="site">{@render children()}</main>
