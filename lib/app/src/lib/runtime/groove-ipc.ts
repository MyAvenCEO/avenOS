import { invoke } from '@tauri-apps/api/core'

/** Multiplexed Groove IPC (`groove_runtime` on the Rust side). */
export async function grooveRuntime<T = unknown>(
	op: string,
	payload: Record<string, unknown> = {},
): Promise<T> {
	return invoke<T>('groove_runtime', { op, payload })
}
