import { browser } from '$app/environment'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { jazzBootstrap, type JazzStatusReply } from './api'

/**
 * After Touch ID unlock: connect SurrealKV + hydrate local shell.
 * Throws when the shell is not ready — callers should keep the lock gate up or show an error.
 */
export async function bootstrapJazzStrict(): Promise<JazzStatusReply> {
	if (!browser || !isTauriRuntime()) {
		throw new Error('Jazz bootstrap requires the AvenOS desktop runtime.')
	}
	const reply = await jazzBootstrap()
	if (!reply.ready) {
		throw new Error(
			'Local Groove vault did not finish loading — try again or restart the app.',
		)
	}
	return reply
}

/** Legacy: soft bootstrap for paths that already guard on `jazzStatus.ready`. */
export async function bootstrapJazzAfterUnlock(): Promise<JazzStatusReply | null> {
	if (!browser || !isTauriRuntime()) return null
	try {
		return await jazzBootstrap()
	} catch {
		return null
	}
}
