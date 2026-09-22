import { transportError } from '@avenos/chat-engine/transport-error'
import { invoke } from '@tauri-apps/api/core'
import { combinedStudioCatalog } from './studio-catalog'

/** Keep transport codes for recovery, but show the actionable message in the UI. */
export function studioErrorMessage(cause: unknown): string {
	return transportError(cause).message
}

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
