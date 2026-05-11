<script lang="ts">
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
</script>

{#if !PUBLIC_JAZZ_APP_ID}
	<div class="min-h-screen flex items-center justify-center bg-background px-6 text-center text-sm">
		<p>
			<code class="font-mono">PUBLIC_JAZZ_APP_ID</code>
			fehlt. Dev starten (<code class="font-mono">bun dev</code>), damit jazzSvelteKit die .env
			setzt — oder manuell in <code class="font-mono">.env</code> eintragen.
		</p>
	</div>
{:else if client}
	<JazzSvelteProvider {client}>
		{#snippet children({ db: _db })}
			<div
				class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background p-6 sm:p-8 pb-32 sm:pb-36"
			>
				<WorkspaceHeader />
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					{@render pageContent()}
				</div>
			</div>
		{/snippet}
		{#snippet fallback()}
			<div class="min-h-screen flex items-center justify-center bg-background text-sm opacity-50">
				Loading…
			</div>
		{/snippet}
	</JazzSvelteProvider>
{:else}
	<div class="min-h-screen flex items-center justify-center bg-background text-sm opacity-50">
		Loading…
	</div>
{/if}

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
