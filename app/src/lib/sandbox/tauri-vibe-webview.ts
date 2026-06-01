import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { McpUiResourceCsp, McpUiResourcePermissions } from '@modelcontextprotocol/ext-apps/app-bridge'
import {
	collectNativeWebviewScrollTargets,
	findNativeWebviewClearance,
	makeNativeWebviewRectMeasurer,
} from './native-webview-rect'
import { TauriSandboxTransport } from './tauri-webview-transport'

const PROXY_READY = 'ui/notifications/sandbox-proxy-ready'

export function isTauriRuntime(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function doubleRaf(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

export interface TauriSandboxSession {
	label: string
	transport: TauriSandboxTransport
	destroy: () => Promise<void>
}

/**
 * Child WKWebView über `host`, lädt `vibe-sandbox://…/sandbox.html`, synchronisiert Rect per ResizeObserver / Scroll.
 */
export async function createTauriSandboxSession(options: {
	host: HTMLElement
	csp?: McpUiResourceCsp
	permissions?: McpUiResourcePermissions
}): Promise<TauriSandboxSession> {
	const rectFromHost = makeNativeWebviewRectMeasurer(options.host)

	const label = `vibe-sb-${crypto.randomUUID()}`
	const hostOrigin = window.location.origin
	const transport = new TauriSandboxTransport(label)

	let unlistenReady: UnlistenFn | undefined
	const readyPromise = new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error('Sandbox-Proxy (vibe-sandbox-out) Timeout')),
			120_000
		)
		void listen<{ label: string; data: unknown }>('vibe-sandbox-out', (e) => {
			if (e.payload.label !== label) return
			const data = e.payload.data as { method?: string }
			if (data?.method === PROXY_READY) {
				clearTimeout(timeout)
				unlistenReady?.()
				resolve()
			}
		}).then((u) => {
			unlistenReady = u
		})
	})

	await transport.start()

	await doubleRaf()
	await invoke('create_sandbox_webview', {
		label,
		rect: rectFromHost(),
		hostOrigin,
		cspJson: options.csp ? JSON.stringify(options.csp) : null
	})

	await readyPromise
	await doubleRaf()

	const syncRect = async () => {
		await invoke('set_sandbox_webview_rect', {
			label,
			rect: rectFromHost()
		})
	}

	let raf = 0
	const scheduleSync = () => {
		cancelAnimationFrame(raf)
		raf = requestAnimationFrame(() => void syncRect())
	}

	const ro = new ResizeObserver(() => scheduleSync())
	ro.observe(options.host)
	if (options.host.parentElement) {
		ro.observe(options.host.parentElement)
	}
	const clearance = findNativeWebviewClearance(options.host)
	if (clearance) {
		ro.observe(clearance)
	}

	const onScroll = () => scheduleSync()
	const scrollTargets = collectNativeWebviewScrollTargets(options.host)
	for (const t of scrollTargets) {
		t.addEventListener('scroll', onScroll, { passive: true, capture: true })
	}

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', onScroll)
		window.visualViewport.addEventListener('scroll', onScroll)
	}

	await syncRect()

	const destroy = async () => {
		unlistenReady?.()
		for (const t of scrollTargets) {
			t.removeEventListener('scroll', onScroll, { capture: true })
		}
		if (window.visualViewport) {
			window.visualViewport.removeEventListener('resize', onScroll)
			window.visualViewport.removeEventListener('scroll', onScroll)
		}
		ro.disconnect()
		cancelAnimationFrame(raf)
		await transport.close()
		await invoke('destroy_sandbox_webview', { label })
	}

	return { label, transport, destroy }
}
