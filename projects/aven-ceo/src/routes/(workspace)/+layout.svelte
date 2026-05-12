<script lang="ts">
// Jazz POC (dewired): re-enable `jazzSvelteKit` in `vite.config.ts`, restore `PUBLIC_JAZZ_*` in `.env`,
// then replace this layout with the previous `JazzSvelteProvider` + client bootstrap from git history.

import WorkspaceHeader from '$lib/workspace/WorkspaceHeader.svelte'

let { children: pageContent } = $props()

/*
	import {
		BrowserAuthSecretStore,
		createJazzClient,
		type JazzClient,
		JazzSvelteProvider
	} from 'jazz-tools/svelte'
	import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$env/static/public'
	import WorkspaceHeader from '$lib/workspace/WorkspaceHeader.svelte'

	let { children: pageContent } = $props()

	const serverUrl = PUBLIC_JAZZ_SERVER_URL?.trim() || undefined

	let client = $state<Promise<JazzClient> | null>(null)

	if (typeof window !== 'undefined' && PUBLIC_JAZZ_APP_ID) {
		BrowserAuthSecretStore.getOrCreateSecret({ appId: PUBLIC_JAZZ_APP_ID }).then((secret) => {
			client = createJazzClient({
				appId: PUBLIC_JAZZ_APP_ID,
				serverUrl,
				secret,
				userBranch: 'main',
				env: import.meta.env.DEV ? 'dev' : 'prod'
			})
		})
	}
*/
</script>

<div
	class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background px-6 pt-4 pb-24 sm:px-8 sm:pt-5 sm:pb-28"
>
	<WorkspaceHeader />
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{@render pageContent()}
	</div>
</div>

<!--
	{#if !PUBLIC_JAZZ_APP_ID}
		<div class="min-h-screen flex items-center justify-center bg-background px-6 text-center text-sm">…</div>
	{:else if client}
		<JazzSvelteProvider {client}>…</JazzSvelteProvider>
	{:else}
		<div class="min-h-screen flex items-center justify-center bg-background text-sm opacity-50">Loading…</div>
	{/if}
-->

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
