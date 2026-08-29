<script lang="ts">
import { goto } from '$app/navigation'
import { authClient } from '$lib/auth-client.js'

const session = authClient.useSession()
$effect(() => {
	if ($session.data) void goto('/dashboard')
})
</script>
<svelte:head><title>Aven Identity</title></svelte:head>
<section class="panel auth">
	<img src="/aven-logo.svg" alt="" class="mark" width="56" height="56">
	<h1>One small, secure identity.</h1>
	<p>Passkey-only sign-in and short-lived authorization for Aven services.</p>
	<div class="actions">
		<a class="primary-action" href="/login">Sign in</a>
	</div>
</section>
