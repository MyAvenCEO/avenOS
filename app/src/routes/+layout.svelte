<script lang="ts">
import '../app.css'
import AuthGate from '$lib/auth/AuthGate.svelte'

/**
 * The whole shell. avenCITY renders full-screen and owns its own scene, so the
 * layout loads the stylesheet and keeps native routes behind the first-launch
 * passkey gate. Browser development remains ungated.
 */
const { children } = $props()
</script>

<svelte:head>
	<title>avenOS</title>
	<link rel="icon" href="/favicon.png" type="image/png" sizes="32x32">
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="128x128">
</svelte:head>

<AuthGate>{@render children()}</AuthGate>
