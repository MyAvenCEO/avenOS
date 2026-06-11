import { invoke } from '@tauri-apps/api/core'

/**
 * Errors that are TRANSIENT during a grant/revoke/sync window: the vault shell is
 * mid-re-hydration — a freshly synced biscuit, keyshare or DEK hasn't been ingested
 * yet. They fail at the authorize/decrypt step (BEFORE any state change), and resolve
 * on their own once the on-inbound re-hydration (M8 B2/B3) completes. So we retry
 * briefly instead of dead-ending the UI with a raw error string. Anything else throws
 * immediately (a genuine permission/validation failure).
 */
const TRANSIENT_PATTERNS = [
	'subject_not_owner',
	'missing_dek_cached',
	'missing_dek',
	'missing DEK',
	'unknown_identity',
	'not loaded',
	'not_loaded',
	'not claimed',
	'ShellNotReady',
	'shell_not_ready',
	'avendbShellNotReady'
]

function isTransientShellError(err: unknown): boolean {
	const m = err instanceof Error ? err.message : String(err)
	return TRANSIENT_PATTERNS.some((p) => m.includes(p))
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Multiplexed avenDB IPC (`avendb_runtime` on the Rust side). Transient shell errors
 *  (re-hydration window) auto-retry with backoff so add/revoke/read self-heal (B4). */
export async function avenDbRuntime<T = unknown>(
	op: string,
	payload: Record<string, unknown> = {}
): Promise<T> {
	let lastErr: unknown
	// Up to 6 attempts over ~4.5s — covers the re-hydration window after a grant or a
	// synced membership change lands. Retries are safe: transient failures occur before
	// any write is applied.
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			return await invoke<T>('avendb_runtime', { op, payload })
		} catch (e) {
			lastErr = e
			if (!isTransientShellError(e)) throw e
			await sleep(250 + attempt * 350)
		}
	}
	throw lastErr
}
