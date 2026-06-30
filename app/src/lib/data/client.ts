import type { Flow, FlowRun } from '@avenos/aven-skills'
import type { Contact, ContactType } from '@avenos/aven-vibes/contact'
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

/** List ANY registered composite type's rows for the signed-in user (board 0096). */
export async function listType<T = Record<string, unknown>>(type: string): Promise<T[]> {
	const { items } = await api<{ items: T[] }>(`/api/data/type/${type}`)
	return items
}

/** The addressbook from the ONTOLOGY (board 0096): the `company` + `person` composite types mapped into
 *  the Contact shape the AddressbookVibe renders — replacing the legacy `contact` data_schema, so the
 *  vendor company + Ansprechpartner enriched by the invoice flow actually appear. */
export async function listContacts(): Promise<{ id: string; data: Contact }[]> {
	const [companies, persons] = await Promise.all([
		listType<Record<string, unknown>>('company'),
		listType<Record<string, unknown>>('person')
	])
	const s = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
	const base = (id: string, type: ContactType, name: string): Contact => ({
		short_id: id.slice(0, 8),
		type,
		name,
		legal_form: null,
		is_self: false,
		street: null,
		zip: null,
		city: null,
		country: null,
		vat_id: null,
		tax_number: null,
		email: null,
		phone: null,
		iban: null,
		bic: null,
		bank_name: null,
		contact_person: null,
		register_court: null,
		register_number: null,
		managing_director: null,
		notes: null
	})
	const companyRows = companies.map((c) => ({
		id: String(c.id),
		data: {
			...base(String(c.id), 'company', s(c.name) ?? ''),
			vat_id: s(c.vat_id),
			tax_number: s(c.tax_number),
			email: s(c.email),
			phone: s(c.phone),
			iban: s(c.iban),
			street: s(c.postal)
		}
	}))
	const personRows = persons.map((p) => ({
		id: String(p.id),
		data: { ...base(String(p.id), 'person', s(p.name) ?? ''), email: s(p.email), represents: s(p.represents) }
	}))
	return [...companyRows, ...personRows]
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

// Todos (board 0087) — stored as gismu predications (task+valid), surfaced via /api/data/todos
// which delegates to the same executeTodos path the LLM tool uses. The UI never touches a
// `todos` schema directly anymore.
export type Todo = {
	id: string
	title: string
	done: boolean
	due?: string | null
	priority?: string | null
}

export async function listTodos(): Promise<Todo[]> {
	const { todos } = await api<{ todos: Todo[] }>('/api/data/todos')
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
