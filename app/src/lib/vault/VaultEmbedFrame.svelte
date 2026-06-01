<script lang="ts">
	import { page } from '$app/state'
	import { onDestroy, tick } from 'svelte'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { createVaultEmbedSession } from '$lib/vault/tauri-vault-embed'
	import { t } from '$lib/i18n'

	let host = $state<HTMLElement | null>(null)
	let initError = $state<string | null>(null)
	let teardown: (() => Promise<void>) | null = null

	const embedPath = $derived(page.url.pathname)
	const unlocked = $derived($deviceSession.kind === 'unlocked')

	$effect(() => {
		void embedPath
		void unlocked
		void (async () => {
			await teardown?.()
			teardown = null
			initError = null
			if (!isTauriRuntime() || !unlocked || !host) return
			await tick()
			if (!host) return
			try {
				const session = await createVaultEmbedSession({ host, path: embedPath })
				teardown = session.destroy
			} catch (e) {
				initError = e instanceof Error ? e.message : String(e)
			}
		})()
	})

	onDestroy(() => {
		void teardown?.()
		teardown = null
	})
</script>

<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
	{#if initError}
		<p class="text-destructive mb-2 shrink-0 text-sm" role="alert">{initError}</p>
	{/if}
	{#if !unlocked}
		<p class="text-muted-foreground shrink-0 py-8 text-sm">{t('vaultNav.lockedHint')}</p>
	{:else if isTauriRuntime()}
		<!--
			Match vibe viewers (DisplayView / docs vibe-apps): scope wrapper, top inset,
			then native host. Clearance keeps the WKWebView below siblings that paint under it.
		-->
		<div
			data-native-webview-scope
			class="mt-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:mt-6"
		>
			<div
				bind:this={host}
				title="Vault embed host"
				class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-transparent"
			></div>
		</div>
	{/if}
</div>
