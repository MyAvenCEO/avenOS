import { browser } from '$app/environment'
import { markAvenDbShellReadyAfterUnlock } from '$lib/runtime/avendb-shell'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { type AvenDbStatusReply, avendbBootstrap } from './api'

/**
 * After Touch ID unlock: connect SurrealKV + hydrate local shell.
 * Throws when the shell is not ready — callers should keep the lock gate up or show an error.
 */
export async function bootstrapAvenDbStrict(): Promise<AvenDbStatusReply> {
	if (!browser || !isTauriRuntime()) {
		throw new Error('AvenDb bootstrap requires the AvenOS desktop runtime.')
	}
	const reply = await avendbBootstrap()
	markAvenDbShellReadyAfterUnlock(reply)
	if (!reply.ready) {
		const detail = reply.message?.trim()
		throw new Error(
			detail
				? `Local avenDB vault did not finish loading: ${detail}`
				: 'Local avenDB vault did not finish loading — try again or restart the app.'
		)
	}
	return reply
}

/** Legacy: soft bootstrap for paths that already guard on `avenDbStatus.ready`. */
export async function bootstrapAvenDbAfterUnlock(): Promise<AvenDbStatusReply | null> {
	if (!browser || !isTauriRuntime()) return null
	try {
		return await avendbBootstrap()
	} catch {
		return null
	}
}
