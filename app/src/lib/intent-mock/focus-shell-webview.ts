/**
 * When a Tauri **child** WKWebView (vibe sandbox) has OS focus, the host shell
 * never receives `keydown` / clicks under the child. Call this before composer
 * interactions and on bottom-bar pointerdown so the shell webview can take focus.
 */
export async function focusShellWebview(): Promise<void> {
	if (typeof window === 'undefined') return
	if (!('__TAURI_INTERNALS__' in window)) return
	try {
		const { getCurrentWebview } = await import('@tauri-apps/api/webview')
		await getCurrentWebview().setFocus()
	} catch {
		/* non-Tauri or API unavailable */
	}
}
