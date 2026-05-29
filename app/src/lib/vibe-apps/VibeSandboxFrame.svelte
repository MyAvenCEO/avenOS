<script lang="ts">
import type { AppBridge } from '@avenos/vibe-app-sandbox'
import { createAppBridge, log, runApp } from '@avenos/vibe-app-sandbox'
import { type VibeAppId, vibeAppById } from '@avenos/vibe-apps'
import { onDestroy, onMount, tick } from 'svelte'
import bankStatementHtml from '../../../../libs/vibe-apps/bank-statement/index.html?raw'
import contractHtml from '../../../../libs/vibe-apps/contract/index.html?raw'
import invoiceHtml from '../../../../libs/vibe-apps/invoice/index.html?raw'
import todosHtml from '../../../../libs/vibe-apps/todos/index.html?raw'
import { createTauriSandboxSession, isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

type RunAppToolResult = Parameters<typeof runApp>[2]['toolResult']

const bundles: Record<VibeAppId, string> = {
	todos: todosHtml,
	invoice: invoiceHtml,
	'bank-statement': bankStatementHtml,
	contract: contractHtml
}

let { appId }: { appId: VibeAppId } = $props()

let host = $state<HTMLElement | null>(null)
let bridge = $state<AppBridge | null>(null)
let initError = $state<string | null>(
	isTauriRuntime()
		? null
		: 'Vibe-Apps laufen nur in der Desktop-App (Tauri mit Child-WebView). Start: «bun dev:app:macos» bzw. «bun run --cwd app tauri dev».'
)
let tauriTeardown: (() => Promise<void>) | null = null

onMount(() => {
	void (async () => {
		if (!isTauriRuntime()) return
		await tick()
		const def = vibeAppById(appId)
		const html = bundles[appId]
		if (!html?.trim()) {
			initError = `Fehlende Vibe-App-HTML für „${appId}“ (libs/vibe-apps/${appId}/index.html).`
			return
		}
		try {
			if (!host) {
				initError = 'Kein Sandbox-Platzhalter — bitte UI prüfen.'
				return
			}
			const session = await createTauriSandboxSession({ host })
			tauriTeardown = session.destroy
			const b = createAppBridge(host, undefined, {
				containerDimensions: { maxHeight: 6000 },
				displayMode: 'inline'
			})
			bridge = b
			await runApp({ transport: session.transport }, b, {
				html,
				toolArguments: def.getToolArguments(),
				toolResult: def.getToolResult() as RunAppToolResult
			})
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

	{#if isTauriRuntime()}
		<div
			bind:this={host}
			title="Vibe-Sandbox-Platzhalter"
			class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-transparent"
		></div>
	{/if}
</div>
