import { listen } from '@tauri-apps/api/event'

export const SHELL_COMPOSER_SHORTCUT_EVENT = 'vibe-sandbox-shell-composer-shortcut'

type ShellComposerPayload = {
	key: string
	code: string
	metaKey?: boolean
	ctrlKey?: boolean
	altKey?: boolean
	shiftKey?: boolean
}

let bridgeStarted = false

/**
 * Vibe sandbox runs in a separate WKWebView; Space / typing there does not reach
 * the host document. The sandbox emits {@link SHELL_COMPOSER_SHORTCUT_EVENT};
 * we focus the shell and replay a synthetic `keydown` so `IntentComposer` behaves
 * the same as on the Intents page without the sandbox.
 */
export function ensureComposerTauriShortcutBridge(): void {
	if (bridgeStarted || typeof window === 'undefined') return
	if (!('__TAURI_INTERNALS__' in window)) return
	bridgeStarted = true

	void listen<ShellComposerPayload>(SHELL_COMPOSER_SHORTCUT_EVENT, (event) => {
		const p = event.payload
		void (async () => {
			const { getCurrentWebview } = await import('@tauri-apps/api/webview')
			await getCurrentWebview().setFocus()
			requestAnimationFrame(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: p.key,
						code: p.code,
						bubbles: true,
						cancelable: true,
						metaKey: !!p.metaKey,
						ctrlKey: !!p.ctrlKey,
						altKey: !!p.altKey,
						shiftKey: !!p.shiftKey
					})
				)
			})
		})()
	})
}
