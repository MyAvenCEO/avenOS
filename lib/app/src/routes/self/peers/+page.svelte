<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import SelfTrustedPeersPanel from '$lib/self/SelfTrustedPeersPanel.svelte'
	import { useSelfContext } from '$lib/self/self-context.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { isIosHostedTauriShell } from '$lib/tauri/tauri-shell-platform'

	const ctx = useSelfContext()

	onMount(() => {
		if (browser && isTauriRuntime() && isIosHostedTauriShell()) {
			void goto('/self')
		}
	})
</script>

<svelte:head>
	<title>Peers · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Peers</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Trust another device on your account, then share sparks with them.
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<SelfTrustedPeersPanel />
</div>
