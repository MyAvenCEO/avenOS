<script lang="ts">
import type { SyncConfig } from 'jazz-tools'
import { JazzSvelteProvider } from 'jazz-tools/svelte'
import { beforeNavigate, goto } from '$app/navigation'
import favicon from '$lib/assets/favicon.svg'
import { AvenOSAccount } from '$lib/schema'
import '../app.css'

let { children } = $props()

const sync: SyncConfig = {
	peer: (import.meta.env.PUBLIC_JAZZ_SYNC_PEER ?? 'wss://v2.sync.jazz.tools') as `wss://${string}`
}
</script>

<svelte:head> <link rel="icon" href={favicon}> </svelte:head>

<JazzSvelteProvider
	{sync}
	AccountSchema={AvenOSAccount}
	enableSSR={true}
	defaultProfileName="You"
	navigation={{ beforeNavigate, goto }}
>
	{#snippet children()}
		{@render children()}
	{/snippet}
</JazzSvelteProvider>
