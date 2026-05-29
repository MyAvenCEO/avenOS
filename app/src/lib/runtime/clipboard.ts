/**
 * Clipboard helper that works inside the Tauri macOS App Sandbox.
 *
 * `navigator.clipboard.writeText()` silently fails on macOS App Store builds because the
 * webview lacks the `WKWebsiteDataStore` permission — the clipboard plugin uses native
 * AppKit / UIKit APIs which DO work under sandbox. We try the plugin first, then fall
 * back to the browser API for non-Tauri / dev-server contexts.
 *
 * Returns `true` on success, `false` if both paths fail (caller decides whether to surface
 * a UI error). Never throws.
 */
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

export async function copyToClipboard(text: string): Promise<boolean> {
	if (isTauriRuntime()) {
		try {
			const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
			await writeText(text)
			return true
		} catch (e) {
			console.warn('clipboard plugin write failed, falling back to navigator.clipboard', e)
		}
	}
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch (e) {
		console.warn('navigator.clipboard.writeText failed', e)
		return false
	}
}
