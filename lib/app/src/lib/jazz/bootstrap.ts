import { browser } from '$app/environment'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { jazzBootstrap, type JazzStatusReply } from './api'

/** After Touch ID unlock (or dev bypass): connect SurrealKV + Jazz client in the shell. Ignores failures (e.g. still locked). */
export async function bootstrapJazzAfterUnlock(): Promise<JazzStatusReply | null> {
	if (!browser || !isTauriRuntime()) return null
	try {
		return await jazzBootstrap()
	} catch {
		return null
	}
}
