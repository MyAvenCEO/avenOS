<script lang="ts">
import '../app.css'
import { goto } from '$app/navigation'
import { authClient } from '$lib/auth-client.js'

let { children } = $props()
const session = authClient.useSession()
async function logout() {
	await authClient.signOut()
	void goto('/')
}
</script>

<header class="site">
	<a href="/" class="brand">Aven</a>
	<nav>
		{#if $session.data}
			<a href="/dashboard">Dashboard</a>
			<button class="link" onclick={logout}>Log out</button>
		{:else}
			<a href="/login">Login</a>
		{/if}
	</nav>
</header>
<main class="site">{@render children()}</main>
