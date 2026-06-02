/**
 * Lightweight in-memory console capture for the "Copy debug" affordance.
 *
 * Patches `console.*` to also append to a bounded ring buffer, so a user can
 * copy recent frontend logs + key state to the clipboard and paste them when
 * reporting an issue. Original console behaviour is preserved.
 */

import { invoke } from '@tauri-apps/api/core'

export type CapturedLog = { t: number; level: string; msg: string }

/**
 * Pull the device's recent Rust log lines (the in-memory ring fed by the
 * `tracing`/`log` bridge — includes `groove::sync_manager` forwarding-gate lines
 * and `avenos::*` peer/sync lifecycle). This is what shows whether a peer (incl.
 * the replication/server peer) actually received and forwarded a batch. Empty
 * outside the Tauri runtime (web/dev preview).
 */
export async function recentRustLogs(): Promise<string[]> {
	try {
		return await invoke<string[]>('avenos_recent_rust_logs')
	} catch {
		return []
	}
}

const RING: CapturedLog[] = []
const MAX = 1000
let installed = false

function fmt(a: unknown): string {
	if (typeof a === 'string') return a
	if (a instanceof Error) return `${a.name}: ${a.message}`
	try {
		return JSON.stringify(a)
	} catch {
		return String(a)
	}
}

/** Patch console once (browser only). Safe to call repeatedly. */
export function installConsoleCapture(): void {
	if (installed || typeof window === 'undefined') return
	installed = true
	for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
		const orig = console[level].bind(console)
		console[level] = (...args: unknown[]) => {
			try {
				RING.push({ t: Date.now(), level, msg: args.map(fmt).join(' ') })
				if (RING.length > MAX) RING.shift()
			} catch {
				/* never let logging break the app */
			}
			orig(...args)
		}
	}
}

export function capturedLogs(): CapturedLog[] {
	return RING.slice()
}

export function clearCapturedLogs(): void {
	RING.length = 0
}

/**
 * Build a copy-pasteable report: optional state block + the device Rust log ring
 * (sync forwarding gate, peer registration) + the frontend console ring.
 */
export function formatDebugReport(state?: Record<string, unknown>, rustLogs?: string[]): string {
	let out = `avenOS debug report — ${new Date().toISOString()}\n`
	out += `userAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}\n\n`
	if (state) {
		out += '=== STATE ===\n'
		try {
			out += `${JSON.stringify(state, null, 2)}\n\n`
		} catch {
			out += '<unserializable state>\n\n'
		}
	}
	if (rustLogs && rustLogs.length > 0) {
		out += `=== RUST SYNC LOG (${rustLogs.length}) ===\n`
		out += `${rustLogs.join('\n')}\n\n`
	}
	out += `=== CONSOLE (${RING.length}) ===\n`
	out += RING.map(
		(e) => `[${new Date(e.t).toISOString()}] ${e.level.toUpperCase()} ${e.msg}`,
	).join('\n')
	return out
}
