import type { ApiError, HealthStatus } from '$lib/types.js'
import { designerApi, designerMode } from '$lib/designer.js'

export class ApiClientError extends Error {
	constructor(
		public status: number,
		public body: ApiError
	) {
		super(body.message)
	}
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
	if (designerMode) return designerApi<T>(path, options)
	const response = await fetch(`/api${path}`, {
		...options,
		headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
	})
	if (!response.ok) throw new ApiClientError(response.status, (await response.json()) as ApiError)
	return response.json() as Promise<T>
}

export const getHealth = () => api<HealthStatus>('/health/status')
