import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { SchemaTables } from '@avenos/jazz-schema'

export type JazzStatusReply = {
	ready: boolean
	tables: string[]
}

export type JazzSessionReply = {
	peerDid: string
	peerDidShort: string
	defaultSparkUrn: string
}

export async function jazzSession(): Promise<JazzSessionReply> {
	return invoke<JazzSessionReply>('jazz_session')
}

export async function jazzBootstrap(): Promise<JazzStatusReply> {
	return invoke<JazzStatusReply>('jazz_bootstrap')
}

export async function jazzStatus(): Promise<JazzStatusReply> {
	return invoke<JazzStatusReply>('jazz_status')
}

/** Re-register allowlisted Hyperswarm peers + Groove sync (safe to call after peer table changes). */
export type JazzPeerMeshRefreshReply = {
	registeredCount: number
}

export async function jazzPeerMeshRefresh(): Promise<JazzPeerMeshRefreshReply> {
	return invoke<JazzPeerMeshRefreshReply>('jazz_peer_mesh_refresh')
}

/** Add a network peer as spark admin (biscuit + DEK keyshare); peer must be in My Network allowlist. */
export async function sparkAdminAdd(payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await invoke<void>('spark_admin_add', {
		sparkId: payload.sparkId,
		peerDid: payload.peerDid,
	})
}

export type SparkAdminListReply = {
	adminDids: string[]
}

export async function sparkAdminList(sparkId: string): Promise<SparkAdminListReply> {
	return invoke<SparkAdminListReply>('spark_admin_list', { sparkId })
}

export async function sparkAdminRevoke(_payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await invoke<void>('spark_admin_revoke', _payload)
}

/** Result of `jazz_explorer_list` — rows omit unauthorized biscuit/spark gates; count is diagnostics-only. */
export type JazzExplorerListReply = {
	rows: Record<string, unknown>[]
	skippedUnauthorizedRows: number
}

/** List any manifest table without typing against `SchemaTables` (explorer / tooling). */
export async function jazzExplorerList(table: string): Promise<JazzExplorerListReply> {
	return invoke<JazzExplorerListReply>('jazz_explorer_list', { table })
}

export async function jazzExplorerSubscribe(
	table: string,
	handler: (rows: Record<string, unknown>[]) => void,
): Promise<UnlistenFn> {
	const event = `jazz:${table}:changed`
	const unlisten = await listen<Record<string, unknown>[]>(event, (e) => handler(e.payload))
	await invoke('jazz_subscribe', { table })
	return unlisten
}

type DbRowExtraOmit<R> = 'spark_id' extends keyof R ? 'spark_id' : never

/** Omit `id` (and `spark_id` when the row has one); shell may inject `spark_id`. */
type JazzCreatePayload<R extends { id: string }> = Omit<
	R,
	'id' | DbRowExtraOmit<R>
> &
	('spark_id' extends keyof R ? { spark_id?: string } : {})

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
		async create(values: JazzCreatePayload<Row>): Promise<Row> {
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
