import type { Flow, FlowRun } from '@avenos/aven-skills'
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

/** The vibe bundle (view/style/logic) from the `vibe.*` registry (config-as-data, board 0095) — the app
 *  loads a vibe's definition from the DB and renders it through the engine instead of importing TS files. */
export async function loadVibeBundle(
	name: string
): Promise<{ view: unknown; style: unknown; logic: string }> {
	return api(`/api/vibe/${name}`)
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

// Flow/skill CONFIG templates (board 0087, Layer A) — admin-only; the server returns 403 for
// non-admins. Distinct from the user-scoped data store above. Skills/Runs views read from here.
export async function listFlows(): Promise<Flow[]> {
	const { flows } = await api<{ flows: Flow[] }>('/api/admin/flows')
	return flows
}

/** The signed-in user's REAL skill runs (persisted flow_run traces, newest first). board 0090. */
export async function listRuns(): Promise<FlowRun[]> {
	const { runs } = await api<{ runs: FlowRun[] }>('/api/skills/runs')
	return runs
}

/** board 0100 — the ACTUAL content of an actor node's declared attached context (a reference text or a
 *  live registry list), resolved by the universal `/api/context/:provider` endpoint. */
export type NodeContextPayload = {
	provider: string
	kind: 'text' | 'list'
	label?: string
	text?: string
	items?: { name: string; gloss?: string; tag?: string }[]
	meta?: Record<string, unknown>
}
export async function loadContext(provider: string, arg?: string): Promise<NodeContextPayload> {
	const qs = arg ? `?arg=${encodeURIComponent(arg)}` : ''
	return api<NodeContextPayload>(`/api/context/${encodeURIComponent(provider)}${qs}`)
}

// Todos (board 0087) — stored as gismu predications (task+valid), surfaced via /api/data/todos
// which delegates to the same executeTodos path the LLM tool uses. The UI never touches a
// `todos` schema directly anymore.
export type Todo = {
	id: string
	title: string
	done: boolean
	due?: string | null
	priority?: string | null
	/** board 0112 — Planner: the goal/group label this task belongs to (member_of.x2). */
	goal?: string | null
	/** board 0112 — Planner: the parent task's row id for a sub-task (part_of.x2). */
	parent?: string | null
}

// A universal list filter over any projected field: { field, value, op? }. board 0107.
export type TodoFilter = { field: string; value?: unknown; op?: string }

export async function listTodos(filter?: TodoFilter): Promise<Todo[]> {
	const q = filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : ''
	const { todos } = await api<{ todos: Todo[] }>(`/api/data/todos${q}`)
	return todos
}

export async function createTodos(
	items: { title: string; done?: boolean; due?: string; priority?: string }[]
): Promise<void> {
	await api('/api/data/todos', { method: 'POST', body: JSON.stringify({ items }) })
}

export async function updateTodos(
	items: {
		id: string
		title?: string
		done?: boolean
		due?: string | null
		priority?: string | null
	}[]
): Promise<void> {
	await api('/api/data/todos', { method: 'PATCH', body: JSON.stringify({ items }) })
}

export async function deleteTodo(id: string): Promise<void> {
	await api(`/api/data/todos/${id}`, { method: 'DELETE' })
}
