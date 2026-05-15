import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { McpUiResourceCsp, McpUiResourcePermissions } from '@modelcontextprotocol/ext-apps/app-bridge'
import { TauriSandboxTransport } from './tauri-webview-transport'

const PROXY_READY = 'ui/notifications/sandbox-proxy-ready'
const NATIVE_WEBVIEW_CLEARANCE_GAP_PX = 8

export function isTauriRuntime(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Map host DOM rect → **logical/CSS** bounds for the native child webview (Tauri `Logical*`).
 *
 * `getBoundingClientRect()` is already in the same **layout** coordinate system wry expects for
 * `LogicalPosition`/`LogicalSize`. Converting through **physical** pixels using JS `scaleFactor()`
 * can diverge from WebKit’s `backingScaleFactor()` and shrink **Y**, which drew the WKWebView too
 * high (over the app header / Activity tabs).
 *
 * Floor **left/top** and ceil **right/bottom** on the CSS pixel grid so the native rect fully covers
 * the host after wry’s `i32` sizing.
 *
 * Native child webviews always paint above the host DOM. In the Intents main panel, the tab strip is
 * a sibling just above the sandbox body, so clamp the native top edge below the strip. This is a
 * layout invariant, not a magic offset: if the host is already lower, this does nothing.
 */
function makeRectMeasurer(host: HTMLElement) {
	return (): { x: number; y: number; w: number; h: number; minY: number } => {
		const r = host.getBoundingClientRect()
		const left = Math.floor(r.left)
		const clearanceBottom = nativeWebviewClearanceBottom(host)
		const top = Math.max(Math.floor(r.top), clearanceBottom)
		const right = Math.ceil(r.right)
		const bottom = Math.ceil(r.bottom)
		const w = Math.max(1, right - left)
		const h = Math.max(1, bottom - top)
		return { x: left, y: top, w, h, minY: clearanceBottom }
	}
}

function nativeWebviewClearanceBottom(host: HTMLElement): number {
	const clearance = findNativeWebviewClearance(host)
	if (!clearance) return 0
	return Math.ceil(clearance.getBoundingClientRect().bottom + NATIVE_WEBVIEW_CLEARANCE_GAP_PX)
}

function findNativeWebviewClearance(host: HTMLElement): HTMLElement | null {
	const root = host.closest('[data-native-webview-scope]') ?? document
	const clearance = root.querySelector('[data-native-webview-clearance="activity-tabs"]')
	if (!(clearance instanceof HTMLElement)) return null
	return clearance
}

function doubleRaf(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

/** Scroll containers between `host` and the viewport (aside panels, nested flex, etc.). */
function collectScrollTargets(host: HTMLElement): EventTarget[] {
	const out: EventTarget[] = []
	const seen = new Set<EventTarget>()
	let el: HTMLElement | null = host
	while (el) {
		const st = getComputedStyle(el)
		const oy = st.overflowY
		const ox = st.overflowX
		const yScroll = el.scrollHeight > el.clientHeight + 1
		const xScroll = el.scrollWidth > el.clientWidth + 1
		if (
			(yScroll && /^(auto|scroll|overlay)$/.test(oy)) ||
			(xScroll && /^(auto|scroll|overlay)$/.test(ox))
		) {
			if (!seen.has(el)) {
				seen.add(el)
				out.push(el)
			}
		}
		el = el.parentElement
	}
	if (!seen.has(window)) {
		out.push(window)
	}
	return out
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
	const rectFromHost = makeRectMeasurer(options.host)

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
	const scrollTargets = collectScrollTargets(options.host)
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
