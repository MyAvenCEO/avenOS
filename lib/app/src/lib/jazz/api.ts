import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { SchemaTables } from '@avenos/jazz-schema'

export type JazzStatusReply = {
	ready: boolean
	tables: string[]
}

export async function jazzBootstrap(): Promise<JazzStatusReply> {
	return invoke<JazzStatusReply>('jazz_bootstrap')
}

export async function jazzStatus(): Promise<JazzStatusReply> {
	return invoke<JazzStatusReply>('jazz_status')
}

/** Table-parameterized IPC CRUD (`jazz-tools` runs in the Rust shell only). */
export function jazzTable<TName extends keyof SchemaTables>(table: TName) {
	type Row = SchemaTables[TName]

	return {
		async list(): Promise<Row[]> {
			return invoke<Row[]>('jazz_list', { table })
		},
		async get(id: string): Promise<Row> {
			return invoke<Row>('jazz_get', { table, id })
		},
		async create(values: Omit<Row, 'id'>): Promise<Row> {
			const valuesPayload = values as Record<string, unknown>
			return invoke<Row>('jazz_create', { table, values: valuesPayload })
		},
		async update(id: string, patch: Partial<Omit<Row, 'id'>>): Promise<Row> {
			const patchPayload = patch as Record<string, unknown>
			return invoke<Row>('jazz_update', { table, id, patch: patchPayload })
		},
		async delete(id: string): Promise<void> {
			await invoke<void>('jazz_delete', { table, id })
		},
		/** Register `jazz:<table>:changed` listener, then start `jazz_subscribe` from the shell. */
		async subscribe(handler: (rows: Row[]) => void): Promise<UnlistenFn> {
			const event = `jazz:${table}:changed`
			const unlisten = await listen<Row[]>(event, (e) => handler(e.payload))
			await invoke('jazz_subscribe', { table })
			return unlisten
		},
	}
}
