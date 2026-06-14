/**
 * Structured sidecar error helpers. Pure (no Tauri imports) so they are unit-testable
 * and so error normalization lives in one place (milestone plan M4 step 5).
 */
import type { SidecarError } from './types'

/** An Error carrying the structured sidecar error fields (code survives .NET → Rust → TS). */
export class SidecarRpcError extends Error implements SidecarError {
	readonly code: string
	readonly retryable: boolean
	readonly data?: unknown

	constructor(err: SidecarError) {
		super(err.message)
		this.name = 'SidecarRpcError'
		this.code = err.code
		this.retryable = err.retryable
		this.data = err.data
	}
}

/**
 * Normalize any thrown value into a {@link SidecarError}. Tauri rejects
 * `agent_sidecar_invoke` with the structured `{ code, message, retryable, data }` object;
 * other failures (opaque Tauri strings, JS errors) collapse to a sensible fallback shape.
 */
export function normalizeSidecarError(err: unknown): SidecarError {
	if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
		const e = err as Record<string, unknown>
		return {
			code: String(e.code),
			message: String(e.message),
			retryable: e.retryable === true,
			data: e.data
		}
	}
	if (err instanceof Error) {
		return { code: 'internal_error', message: err.message, retryable: false }
	}
	return { code: 'internal_error', message: String(err), retryable: false }
}
