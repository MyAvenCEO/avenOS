<script lang="ts">
import '../app.css'
import { goto } from '$app/navigation'
import { readable } from 'svelte/store'
import { authClient } from '$lib/auth-client.js'
import DesignerMenu from '$lib/DesignerMenu.svelte'
import { designerMode } from '$lib/designer.js'

let { children } = $props()
const session = designerMode
	? readable({ data: { user: { name: 'Alex Morgan', email: 'alex@example.com' } } })
	: authClient.useSession()
async function logout() {
	if (designerMode) return
	await authClient.signOut()
	void goto('/')
}
</script>

{#if designerMode}
	<DesignerMenu />
{/if}
<header class="site">
	<a href="/" class="brand">Aven</a>
	<nav>
		{#if designerMode}
			<a href="/dashboard">Dashboard</a>
			<a href="/login">Log out</a>
		{:else if $session.data}
			<a href="/dashboard">Dashboard</a>
			<button class="link" onclick={logout}>Log out</button>
		{:else}
			<a href="/login">Login</a>
		{/if}
	</nav>
</header>
<main class="site">{@render children()}</main>
