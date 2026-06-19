import { getBearerToken } from '$lib/auth/auth-client'

/**
 * Client for the generic, schema-driven data store (board 0053). Every call is
 * session-gated server-side and scoped to the signed-in user. Values are validated
 * against their schema's JSON Schema on the server; validation errors surface as the
 * thrown message. Fully generic — `todos` is just one consumer.
 */
const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	if (!BASE) throw new Error('auth server URL not configured')
	const token = getBearerToken()
	const res = await fetch(`${BASE}${path}`, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init?.headers ?? {})
		}
	})
	if (!res.ok) {
		const err = (await res.json().catch(() => null)) as {
			error?: string
			details?: string[]
		} | null
		throw new Error(err?.details?.join('; ') || err?.error || `HTTP ${res.status}`)
	}
	return res.json() as Promise<T>
}

/** Create or update (by name) a schema; returns its id. */
export async function ensureSchema(name: string, jsonSchema: unknown): Promise<string> {
	const { id } = await api<{ id: string }>('/api/data/schemas', {
		method: 'POST',
		body: JSON.stringify({ name, jsonSchema })
	})
	return id
}

export type DataSchema = { id: string; name: string; jsonSchema: unknown }

/** The signed-in user's schemas (definitions only). */
export async function listSchemas(): Promise<DataSchema[]> {
	const { schemas } = await api<{ schemas: DataSchema[] }>('/api/data/schemas')
	return schemas
}

export type DataValue<T> = { id: string; data: T }

export async function listValues<T>(schemaId: string): Promise<DataValue<T>[]> {
	const { values } = await api<{ values: DataValue<T>[] }>(`/api/data/schemas/${schemaId}/values`)
	return values
}

export async function createValue<T>(schemaId: string, data: T): Promise<DataValue<T>> {
	return api<DataValue<T>>(`/api/data/schemas/${schemaId}/values`, {
		method: 'POST',
		body: JSON.stringify({ data })
	})
}

export async function updateValue<T>(id: string, data: T): Promise<void> {
	await api(`/api/data/values/${id}`, { method: 'PATCH', body: JSON.stringify({ data }) })
}

export async function deleteValue(id: string): Promise<void> {
	await api(`/api/data/values/${id}`, { method: 'DELETE' })
}
