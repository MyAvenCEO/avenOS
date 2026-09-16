import { invoke } from '@tauri-apps/api/core'
import { combinedStudioCatalog } from './studio-catalog'

/** Neutral authorized transport used by both the visual client and the Studio Actor. */
export async function authorizedStudioRequest<T = unknown>(
	operation: string,
	data: Record<string, unknown> = {}
): Promise<T> {
	const remote = <Value>(remoteOperation: string, remoteData: Record<string, unknown>) =>
		invoke<Value>('studio_request', { command: { operation: remoteOperation, data: remoteData } })
	return operation === 'catalog'
		? ((await combinedStudioCatalog(data, remote)) as T)
		: await remote<T>(operation, data)
}
