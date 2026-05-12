<script lang="ts">
import { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } from '$env/static/public'
import {
	BrowserAuthSecretStore,
	createJazzClient,
	type JazzClient,
	JazzSvelteProvider
} from 'jazz-tools/svelte'
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

{#if !PUBLIC_JAZZ_APP_ID || !client}
	<div
		class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background px-6 pt-4 pb-24 sm:px-8 sm:pt-5 sm:pb-28"
	>
		<WorkspaceHeader />
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			{@render pageContent()}
		</div>
	</div>
{:else}
	<JazzSvelteProvider {client}>
		{#snippet children()}
			<div
				class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background px-6 pt-4 pb-24 sm:px-8 sm:pt-5 sm:pb-28"
			>
				<WorkspaceHeader />
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					{@render pageContent()}
				</div>
			</div>
		{/snippet}
	</JazzSvelteProvider>
{/if}

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
