import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

const VAULT_LABEL = 'vault'

export async function openVaultWindow(): Promise<void> {
	if (!isTauriRuntime()) {
		throw new Error('vault_window_requires_tauri')
	}
	const existing = await WebviewWindow.getByLabel(VAULT_LABEL)
	if (existing) {
		await existing.show()
		await existing.setFocus()
		return
	}
	const win = new WebviewWindow(VAULT_LABEL, {
		url: '/vault/secrets',
		title: 'Vault',
		width: 520,
		height: 680,
		center: true,
		resizable: true,
	})
	await new Promise<void>((resolve, reject) => {
		win.once('tauri://created', () => resolve())
		win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
	})
}

export async function closeVaultWindow(): Promise<void> {
	const existing = await WebviewWindow.getByLabel(VAULT_LABEL)
	if (existing) await existing.close()
}
