import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import {
	collectNativeWebviewScrollTargets,
	findNativeWebviewClearance,
	makeNativeWebviewRectMeasurer,
} from '$lib/sandbox/native-webview-rect'

export const VAULT_EMBED_LABEL = 'vault-embed'

function doubleRaf(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	})
}

/** Child webview URL — same route with `vaultEmbed=1` so the embed skips chrome recursion. */
export function vaultEmbedUrl(path: string): string {
	const u = new URL(path, window.location.origin)
	u.searchParams.set('vaultEmbed', '1')
	return u.href
}

export function isVaultEmbedMode(searchParams: URLSearchParams): boolean {
	return searchParams.get('vaultEmbed') === '1'
}

/** Tear down a legacy vault-embed child webview if one is still attached. */
export async function destroyVaultEmbedWebview(): Promise<void> {
	if (!isTauriRuntime()) return
	try {
		await invoke('destroy_vault_embed_webview')
	} catch {
		/* no embed webview */
	}
}

export interface VaultEmbedSession {
	destroy: () => Promise<void>
}

/**
 * Isolated vault child WKWebView over `host` (macOS Tauri only).
 * Loads `/vault/*?vaultEmbed=1` with capability `vault-embed` — not `plugin:vault` on main.
 */
export async function createVaultEmbedSession(options: {
	host: HTMLElement
	path: string
}): Promise<VaultEmbedSession> {
	if (!isTauriRuntime()) {
		throw new Error('vault_embed_requires_tauri')
	}

	const rectFromHost = makeNativeWebviewRectMeasurer(options.host)
	const url = vaultEmbedUrl(options.path)

	await doubleRaf()
	await invoke('create_vault_embed_webview', {
		rect: rectFromHost(),
		url,
	})

	const syncRect = async () => {
		await invoke('set_vault_embed_webview_rect', { rect: rectFromHost() })
	}

	let raf = 0
	const scheduleSync = () => {
		cancelAnimationFrame(raf)
		raf = requestAnimationFrame(() => void syncRect())
	}

	const ro = new ResizeObserver(() => scheduleSync())
	ro.observe(options.host)
	if (options.host.parentElement) ro.observe(options.host.parentElement)
	const clearance = findNativeWebviewClearance(options.host)
	if (clearance) ro.observe(clearance)

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
		for (const t of scrollTargets) {
			t.removeEventListener('scroll', onScroll, { capture: true })
		}
		if (window.visualViewport) {
			window.visualViewport.removeEventListener('resize', onScroll)
			window.visualViewport.removeEventListener('scroll', onScroll)
		}
		ro.disconnect()
		cancelAnimationFrame(raf)
		try {
			await invoke('destroy_vault_embed_webview')
		} catch {
			/* already torn down */
		}
	}

	return { destroy }
}
