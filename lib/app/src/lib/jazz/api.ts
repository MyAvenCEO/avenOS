import type { UnlistenFn } from '@tauri-apps/api/event'
import type { SchemaTables } from '@avenos/jazz-schema'
import { getTableRowsStore } from '$lib/runtime/table-stores'
import { grooveRuntime } from '$lib/runtime/groove-ipc'

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
	return grooveRuntime<JazzSessionReply>('session', {})
}

export async function jazzBootstrap(): Promise<JazzStatusReply> {
	return grooveRuntime<JazzStatusReply>('bootstrap', {})
}

export async function jazzStatus(): Promise<JazzStatusReply> {
	return grooveRuntime<JazzStatusReply>('status', {})
}

/** Re-register allowlisted Hyperswarm peers + Groove sync (safe to call after peer table changes). */
export type JazzPeerMeshRefreshReply = {
	registeredCount: number
}

export async function jazzPeerMeshRefresh(): Promise<JazzPeerMeshRefreshReply> {
	return grooveRuntime<JazzPeerMeshRefreshReply>('peerMeshRefresh', {})
}

/** Add a network peer as spark admin (biscuit + DEK keyshare); peer must be in My Network allowlist. */
export async function sparkAdminAdd(payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkAdminAdd', {
		sparkId: payload.sparkId,
		peerDid: payload.peerDid,
	})
}

export type SparkAdminListReply = {
	adminDids: string[]
}

export async function sparkAdminList(sparkId: string): Promise<SparkAdminListReply> {
	return grooveRuntime<SparkAdminListReply>('sparkAdminList', { sparkId })
}

export async function sparkAdminRevoke(_payload: {
	sparkId: string
	peerDid: string
}): Promise<void> {
	await grooveRuntime('sparkAdminRevoke', _payload)
}

/** Result of explorer list — rows omit unauthorized biscuit/spark gates; count is diagnostics-only. */
export type JazzExplorerListReply = {
	rows: Record<string, unknown>[]
	skippedUnauthorizedRows: number
}

/** List any manifest table without typing against `SchemaTables` (explorer / tooling). */
export async function jazzExplorerList(table: string): Promise<JazzExplorerListReply> {
	return grooveRuntime<JazzExplorerListReply>('explorerList', { table })
}

/**
 * Ref-counted subscribe on the Groove actor; row snapshots arrive on `avenos:runtime`
 * `{ kind: 'table', table, rows }` → [`getTableRowsStore`].
 */
async function subscribeToTableSnapshot<T>(
	table: string,
	handler: (rows: T[]) => void,
): Promise<UnlistenFn> {
	const st = getTableRowsStore(table)
	const un = st.subscribe((rows) => handler(rows as T[]))
	await grooveRuntime('subscribe', { table })
	return () => {
		un()
		void grooveRuntime('unsubscribe', { table })
	}
}

/** Explorer subscribe: untyped rows over the same single subscribe pipe. */
export async function jazzExplorerSubscribe(
	table: string,
	handler: (rows: Record<string, unknown>[]) => void,
): Promise<UnlistenFn> {
	return subscribeToTableSnapshot<Record<string, unknown>>(table, handler)
}

export type DbRowExtraOmit<R> = 'spark_id' extends keyof R ? 'spark_id' : never

/** Omit `id` (and `spark_id` when the row has one); shell may inject `spark_id`. */
export type JazzCreatePayload<R extends { id: string }> = Omit<
	R,
	'id' | DbRowExtraOmit<R>
> &
	('spark_id' extends keyof R ? { spark_id?: string } : {})

/** Table-parameterized IPC CRUD (`jazz-tools` runs in the Rust shell only). */
export function jazzTable<TName extends keyof SchemaTables>(table: TName) {
	type Row = SchemaTables[TName]

	return {
		async list(): Promise<Row[]> {
			return grooveRuntime<Row[]>('list', { table: String(table) })
		},
		async get(id: string): Promise<Row> {
			return grooveRuntime<Row>('get', { table: String(table), id })
		},
		async create(values: JazzCreatePayload<Row>): Promise<Row> {
			const valuesPayload = values as Record<string, unknown>
			return grooveRuntime<Row>('create', { table: String(table), values: valuesPayload })
		},
		async update(id: string, patch: Partial<Omit<Row, 'id'>>): Promise<Row> {
			const patchPayload = patch as Record<string, unknown>
			return grooveRuntime<Row>('update', {
				table: String(table),
				id,
				patch: patchPayload,
			})
		},
		async delete(id: string): Promise<void> {
			await grooveRuntime('delete', { table: String(table), id })
		},
		/** Row snapshots via `avenos:runtime` `{ kind: 'table' }` (Groove actor). */
		async subscribe(handler: (rows: Row[]) => void): Promise<UnlistenFn> {
			return subscribeToTableSnapshot<Row>(String(table), handler)
		},
	}
}
