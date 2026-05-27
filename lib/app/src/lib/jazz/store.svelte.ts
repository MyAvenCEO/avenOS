import { onDestroy } from 'svelte'
import { get } from 'svelte/store'
import { browser } from '$app/environment'
import type { SchemaTables } from '@avenos/jazz-schema'
import { withTimeoutMs } from '$lib/async-timeout'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { DeviceSession } from '$lib/self/device-session-store'
import { deviceSession } from '$lib/self/device-session-store'
import { grooveSessionReady, waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
import { type JazzCreatePayload, jazzTable } from './api'

/** Subscribe/hydrate under P2P + ACL rehydrate can exceed a few seconds — not a user-facing failure. */
const SUBSCRIBE_BUDGET_MS = 30_000

function deviceSessionFingerprint(s: DeviceSession): string {
	if (s.kind === 'locked') return 'locked'
	return `${s.identity.usernameSlug}:${s.identity.ppkHex}`
}

function rowsEqual<T>(prev: T[], next: T[]): boolean {
	if (prev.length !== next.length) return false
	return JSON.stringify(prev) === JSON.stringify(next)
}

export type JazzStore<TName extends keyof SchemaTables> = {
	/** Current snapshot. Empty array until the first publish lands. */
	readonly rows: SchemaTables[TName][]
	readonly loaded: boolean
	readonly error: string | undefined

	get(id: string): Promise<SchemaTables[TName]>
	create(values: JazzCreatePayload<SchemaTables[TName]>): Promise<SchemaTables[TName]>
	update(id: string, patch: Partial<Omit<SchemaTables[TName], 'id'>>): Promise<SchemaTables[TName]>
	delete(id: string): Promise<void>
}

type InternalPool<TName extends keyof SchemaTables> = {
	refs: number
	store: JazzStore<TName>
	destroy: () => void
}

const pools = new Map<string, InternalPool<keyof SchemaTables>>()

function createTablePool<TName extends keyof SchemaTables>(table: TName): InternalPool<TName> {
	type Row = SchemaTables[TName]

	let rows = $state<Row[]>([])
	let loaded = $state(false)
	let error = $state<string | undefined>()

	const api = jazzTable(table)

	let unlisten: (() => void) | undefined
	let alive = true
	let stopWatch: (() => void) | undefined

	async function start(): Promise<void> {
		if (!browser || !isTauriRuntime()) {
			loaded = true
			return
		}
		const kind = get(deviceSession).kind
		if (kind !== 'unlocked') return
		try {
			if (!get(grooveSessionReady)) {
				await withTimeoutMs(
					waitForGrooveSessionReady(),
					SUBSCRIBE_BUDGET_MS,
					'Groove session ready',
				)
			}
			const u = await withTimeoutMs(
				api.subscribe((next) => {
					if (!alive) return
					const incoming = next as Row[]
					if (!rowsEqual(rows, incoming)) rows = incoming
					loaded = true
				}),
				SUBSCRIBE_BUDGET_MS,
				`${String(table)} subscribe`,
			)
			if (!alive) {
				u()
				return
			}
			loaded = true
			unlisten = u
			void api.list().then((snap) => {
				if (!alive) return
				const incoming = snap as Row[]
				if (!rowsEqual(rows, incoming)) rows = incoming
				loaded = true
			})
		} catch (e) {
			if (!alive) return
			error = e instanceof Error ? e.message : String(e)
			loaded = true
		}
	}

	void start()

	let prevFp = ''
	stopWatch = deviceSession.subscribe(($s) => {
		const fp = deviceSessionFingerprint($s)
		if (prevFp === '') {
			prevFp = fp
			return
		}
		if (fp === prevFp) return
		prevFp = fp
		unlisten?.()
		unlisten = undefined
		rows = []
		loaded = false
		error = undefined
		void start()
	})

	const store: JazzStore<TName> = {
		get rows() {
			return rows
		},
		get loaded() {
			return loaded
		},
		get error() {
			return error
		},
		get(id: string) {
			return api.get(id)
		},
		create(values: JazzCreatePayload<Row>) {
			return api.create(values)
		},
		update(id: string, patch: Partial<Omit<Row, 'id'>>) {
			return api.update(id, patch)
		},
		delete(id: string) {
			return api.delete(id)
		},
	}

	return {
		refs: 0,
		store,
		destroy() {
			alive = false
			unlisten?.()
			stopWatch?.()
		},
	}
}

/**
 * Svelte 5 handle for **one Jazz table**: reactive snapshot + mutations over the unified
 * `change_tx` drain (local CRUD and peer deltas both converge on `jazz:<table>:changed`).
 *
 * One backend subscribe per table per app (ref-counted pool), not per component instance.
 *
 * MUST be called from component `<script>` init (uses `onDestroy`).
 */
export function jazzStore<TName extends keyof SchemaTables>(
	table: TName,
): JazzStore<TName> {
	const key = String(table)
	let pool = pools.get(key) as InternalPool<TName> | undefined
	if (!pool) {
		pool = createTablePool(table)
		pools.set(key, pool as InternalPool<keyof SchemaTables>)
	}

	pool.refs++
	onDestroy(() => {
		pool!.refs--
		if (pool!.refs <= 0) {
			pool!.destroy()
			pools.delete(key)
		}
	})

	return pool.store
}
