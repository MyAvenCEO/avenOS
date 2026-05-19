<script lang="ts">
	import { browser } from '$app/environment'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())
</script>

<svelte:head>
	<title>Talk · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-4">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">Talk</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Messages for this spark — chat UI coming soon.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock to use sparks on this device.</p>
	{:else}
		<div
			class="border-border/60 bg-card/20 flex min-h-[min(50vh,22rem)] flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center"
		>
			<p class="text-muted-foreground text-sm font-medium">Chat placeholder</p>
			<p class="text-muted-foreground max-w-sm text-xs leading-relaxed">
				Threads, mentions, and live sync will show up here. Use <strong>Todos</strong> in the sidebar for task lists today.
			</p>
		</div>
	{/if}
</div>
