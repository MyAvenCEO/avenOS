<script lang="ts">
import {
	BrowserAuthSecretStore,
	createJazzClient,
	type JazzClient,
	JazzSvelteProvider
} from 'jazz-tools/svelte'
import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$env/static/public'

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
			{@render pageContent()}
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
