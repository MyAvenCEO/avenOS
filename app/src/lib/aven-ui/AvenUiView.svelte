<script lang="ts">
import { AvenUiEngine, type UiEvent, type UiFixtureShell } from '@avenos/aven-ui'
import { onDestroy } from 'svelte'
/**
 * Universal aven-ui renderer. Mounts a `UiFixtureShell` through a
 * `sandbox-quickjs` session (runs `initState(source)` / dispatch in an
 * in-process JS sandbox) and renders the resulting view/style/state via
 * `AvenUiEngine` into a shadow DOM. Desktop-only (the QuickJS plugin lives
 * in Tauri) — shows a hint otherwise.
 *
 * Consumed by the docs kitchen sink (`UiLabPanel`), the intent HITL
 * `DisplayView` (vibe + error/success screens), and the vault panel.
 *
 * - `source` overrides `shell.source` and triggers a remount when its
 *   reference changes (used by the vault panel to re-render on mutations).
 * - `onEvent`, when provided, receives view events and the host owns the
 *   reaction (e.g. vault CRUD). Without it, `interactive` views dispatch
 *   back into their own QuickJS session.
 */
import { browser } from '$app/environment'
import {
	listenSandboxQjsState,
	mountRequestFromShell,
	sessionDispatch,
	sessionMount,
	sessionUnmount
} from '$lib/aven-ui/sandbox-qjs-session'
import { t } from '$lib/i18n'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

let {
	shell,
	containerName = 'aven-ui',
	interactive = false,
	source,
	onEvent,
	onState,
	class: className = ''
}: {
	shell: UiFixtureShell
	containerName?: string
	interactive?: boolean
	source?: Record<string, unknown>
	onEvent?: (event: UiEvent) => void
	onState?: (state: Record<string, unknown>) => void
	class?: string
} = $props()

let hostNode: HTMLElement | null = null
let engine: AvenUiEngine | null = null
let sessionId: string | null = null
let unlistenState: (() => void) | null = null
let mountToken = 0
let renderError = $state<string | null>(null)

const inTauri = isTauriRuntime()

async function teardown(): Promise<void> {
	unlistenState?.()
	unlistenState = null
	if (sessionId) {
		try {
			await sessionUnmount(sessionId)
		} catch {
			// ignore teardown errors
		}
		sessionId = null
	}
	await engine?.unmount()
	engine = null
}

async function handleEvent(event: UiEvent, token: number): Promise<void> {
	if (onEvent) {
		onEvent(event)
		return
	}
	if (!interactive || !sessionId || token !== mountToken) return
	try {
		const result = await sessionDispatch({
			sessionId,
			send: event.send,
			payload: event.payload
		})
		if (token !== mountToken) return
		if (result.state && typeof result.state === 'object') {
			await engine?.replaceState(result.state as Record<string, unknown>)
			onState?.(result.state as Record<string, unknown>)
		}
	} catch (err) {
		renderError = err instanceof Error ? err.message : String(err)
	}
}

async function mount(): Promise<void> {
	if (!hostNode || !browser || !inTauri) return
	const token = ++mountToken
	const host = hostNode
	renderError = null
	try {
		await teardown()
		if (token !== mountToken || hostNode !== host) return

		const request = mountRequestFromShell(shell)
		const mounted = await sessionMount(source ? { ...request, source } : request)
		if (token !== mountToken || hostNode !== host) {
			await sessionUnmount(mounted.sessionId).catch(() => {})
			return
		}
		sessionId = mounted.sessionId

		engine = new AvenUiEngine({
			container: host,
			containerName,
			onEvent: (event: UiEvent) => {
				void handleEvent(event, token)
			}
		})
		await engine.mount({ view: shell.view, style: shell.style, state: mounted.state })
		if (token !== mountToken) {
			await teardown()
			return
		}
		onState?.(mounted.state)

		unlistenState = await listenSandboxQjsState((event) => {
			if (event.sessionId !== sessionId || token !== mountToken) return
			void engine?.replaceState(event.state)
			onState?.(event.state)
		})
	} catch (err) {
		if (token !== mountToken) return
		renderError = err instanceof Error ? err.message : String(err)
	}
}

function attachHost(element: HTMLElement) {
	hostNode = element
	void mount()
	return () => {
		if (hostNode === element) hostNode = null
		mountToken += 1
		void teardown()
	}
}

// Remount when the shell or the (referentially-compared) source changes.
$effect(() => {
	void shell
	void source
	if (hostNode) void mount()
})

onDestroy(() => {
	mountToken += 1
	void teardown()
})
</script>

{#if !inTauri}
	<div
		class="text-muted-foreground flex min-h-[200px] flex-1 items-center justify-center px-4 text-center text-sm"
	>
		{t('uiLab.needsDesktop')}
	</div>
{:else}
	{#if renderError}
		<p class="text-destructive shrink-0 px-1 text-sm" role="alert">{renderError}</p>
	{/if}
	<div
		{@attach attachHost}
		class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto {className}"
	></div>
{/if}
