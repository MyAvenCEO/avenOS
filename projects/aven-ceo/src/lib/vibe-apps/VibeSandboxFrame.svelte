<script lang="ts">
import type { AppBridge } from '@avenos/vibe-app-sandbox'
import { createAppBridge, loadSandboxProxy, log, runApp } from '@avenos/vibe-app-sandbox'
import { type VibeAppId, vibeAppById } from '@avenos/vibe-apps'
import { onDestroy, onMount } from 'svelte'
import bankStatementHtml from '../../../../../libs/vibe-apps/bank-statement/index.html?raw'
import invoiceHtml from '../../../../../libs/vibe-apps/invoice/index.html?raw'
import todosHtml from '../../../../../libs/vibe-apps/todos/index.html?raw'

const bundles: Record<VibeAppId, string> = {
	todos: todosHtml,
	invoice: invoiceHtml,
	'bank-statement': bankStatementHtml
}

let { appId }: { appId: VibeAppId } = $props()

let iframe = $state<HTMLIFrameElement | null>(null)
let bridge = $state<AppBridge | null>(null)
let initError = $state<string | null>(null)

onMount(() => {
	void (async () => {
		if (!iframe) return
		const def = vibeAppById(appId)
		const html = bundles[appId]
		if (!html?.trim()) {
			initError = `Fehlende Vibe-App-HTML für „${appId}“ (libs/vibe-apps/${appId}/index.html).`
			return
		}
		try {
			await loadSandboxProxy(iframe)
			const b = createAppBridge(iframe, undefined, {
				containerDimensions: { maxHeight: 6000 },
				displayMode: 'inline'
			})
			bridge = b
			await runApp(iframe, b, {
				html,
				toolArguments: def.getToolArguments(),
				toolResult: def.getToolResult()
			})
		} catch (e) {
			initError = e instanceof Error ? e.message : String(e)
			log.error('Vibe app init failed:', e)
		}
	})()
})

onDestroy(() => {
	if (bridge) {
		void bridge.teardownResource({}).catch(() => {})
		bridge = null
	}
})
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	{#if initError}
		<div
			class="mb-3 shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
			role="alert"
		>
			{initError}
		</div>
	{/if}

	<div
		class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-white/10"
	>
		<iframe
			bind:this={iframe}
			title="Vibe-App-Sandbox"
			class="block min-h-0 w-full flex-1 border-0 bg-transparent"
		></iframe>
	</div>
</div>
