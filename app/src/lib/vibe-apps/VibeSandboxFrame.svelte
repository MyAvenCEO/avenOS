<script lang="ts">
import type { AppBridge } from '@avenos/aven-vibe-sandbox'
import { createAppBridge, loadSandboxProxy, log, runApp } from '@avenos/aven-vibe-sandbox'
import { type VibeAppId, vibeAppById } from '@avenos/aven-vibes'
import { onDestroy, onMount, tick } from 'svelte'
import bankStatementHtml from '../../../../libs/aven-vibes/bank-statement/index.html?raw'
import contractHtml from '../../../../libs/aven-vibes/contract/index.html?raw'
import invoiceHtml from '../../../../libs/aven-vibes/invoice/index.html?raw'
import todosHtml from '../../../../libs/aven-vibes/todos/index.html?raw'
import { createTauriSandboxSession } from '$lib/sandbox/tauri-vibe-webview'
import {
	resolveVibeSandboxStrategy,
	type VibeSandboxStrategy
} from '$lib/sandbox/vibe-sandbox-strategy'

type RunAppToolResult = Parameters<typeof runApp>[2]['toolResult']

const bundles: Record<VibeAppId, string> = {
	todos: todosHtml,
	invoice: invoiceHtml,
	'bank-statement': bankStatementHtml,
	contract: contractHtml
}

let { appId }: { appId: VibeAppId } = $props()

let host = $state<HTMLElement | null>(null)
let iframe = $state<HTMLIFrameElement | null>(null)
let bridge = $state<AppBridge | null>(null)
let strategy = $state<VibeSandboxStrategy>('iframe')
let initError = $state<string | null>(null)
let tauriTeardown: (() => Promise<void>) | null = null

onMount(() => {
	void (async () => {
		await tick()
		const def = vibeAppById(appId)
		const html = bundles[appId]
		if (!html?.trim()) {
			initError = `Fehlende Vibe-App-HTML für „${appId}“ (libs/aven-vibes/${appId}/index.html).`
			return
		}
		try {
			strategy = await resolveVibeSandboxStrategy()
			await tick()
			const sizing = strategy === 'native-webview' ? host : iframe
			if (!sizing) {
				initError = 'Kein Sandbox-Host verfügbar — bitte UI prüfen.'
				return
			}
			const b = createAppBridge(sizing, undefined, {
				containerDimensions: { maxHeight: 6000 },
				displayMode: 'inline'
			})
			bridge = b
			if (strategy === 'native-webview') {
				if (!host) {
					initError = 'Kein nativer Sandbox-Platzhalter — bitte UI prüfen.'
					return
				}
				const session = await createTauriSandboxSession({ host })
				tauriTeardown = session.destroy
				await runApp({ transport: session.transport }, b, {
					html,
					toolArguments: def.getToolArguments(),
					toolResult: def.getToolResult() as RunAppToolResult
				})
			} else {
				if (!iframe) {
					initError = 'Kein iframe-Sandbox-Host — bitte UI prüfen.'
					return
				}
				await loadSandboxProxy(iframe)
				await runApp(iframe, b, {
					html,
					toolArguments: def.getToolArguments(),
					toolResult: def.getToolResult() as RunAppToolResult
				})
			}
		} catch (e) {
			initError = e instanceof Error ? e.message : String(e)
			log.error('Vibe app init failed:', e)
		}
	})()
})

onDestroy(() => {
	void (async () => {
		if (bridge) {
			await bridge.teardownResource({}).catch(() => {})
			bridge = null
		}
		if (tauriTeardown) {
			await tauriTeardown().catch(() => {})
			tauriTeardown = null
		}
	})()
})
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
	{#if initError}
		<div
			class="mb-3 shrink-0 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800"
			role="alert"
		>
			{initError}
		</div>
	{/if}

	{#if strategy === 'native-webview'}
		<div
			bind:this={host}
			title="Vibe-Sandbox-Platzhalter"
			class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-transparent"
		></div>
	{:else}
		<iframe
			bind:this={iframe}
			title="Vibe-Sandbox"
			class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-transparent"
		></iframe>
	{/if}
</div>
