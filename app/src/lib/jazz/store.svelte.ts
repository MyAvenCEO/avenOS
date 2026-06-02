import { onDestroy } from 'svelte'
import { get } from 'svelte/store'
import { browser } from '$app/environment'
import { withTimeoutMs } from '$lib/async-timeout'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { DeviceSession } from '$lib/settings/device-session-store'
import { deviceSession } from '$lib/settings/device-session-store'
import { jazzShell } from '$lib/runtime/jazz-shell'
import { grooveSessionReady, waitForGrooveSessionReady } from '$lib/runtime/groove-runtime'
import { type JazzRow, jazzTable } from './api'

/** Subscribe/hydrate under P2P + ACL rehydrate can exceed a few seconds — not a user-facing failure. */
const SUBSCRIBE_BUDGET_MS = 30_000

function deviceSessionFingerprint(s: DeviceSession): string {
	if (s.kind === 'locked') return 'locked'
	return `${s.identity.usernameSlug}:${s.identity.ppkHex}`
}

function rowsEqual(prev: JazzRow[], next: JazzRow[]): boolean {
	if (prev.length !== next.length) return false
	return JSON.stringify(prev) === JSON.stringify(next)
}

/**
 * How an incoming snapshot is reconciled with current rows.
 *
 * - `replace` (default): the snapshot IS the complete authoritative set of currently-visible
 *   rows, so replacing reflects adds, updates AND deletes. Correct and fully reactive for any
 *   table (todos, messages, files, humans, …) — no per-table code needed.
 * - `catalogue`: defends a "gateway" table (the spark list) against a transient empty/partial
 *   snapshot during a vault-shell re-hydrate (access flicker): ignore empties, merge by key.
 *   Trade-off: catalogue-row *removals* (un-share) need a full reload, not a partial snapshot.
 */
type SnapshotPolicy = 'replace' | 'catalogue'

const TABLE_POLICY: Record<string, SnapshotPolicy> = {
	sparks: 'catalogue',
	keyshares: 'catalogue',
}

/** Natural per-table key for merge dedup; falls back to the generic row `id`. */
function rowKey(row: JazzRow): string {
	const natural = row.spark_id ?? row.sparkId
	if (typeof natural === 'string' && natural.trim()) return natural.trim().toLowerCase()
	return String(row.id ?? '')
}

function applySnapshotRows(table: string, prev: JazzRow[], next: JazzRow[]): JazzRow[] {
	const policy = TABLE_POLICY[table] ?? 'replace'
	if (policy === 'replace') return next
	// catalogue: ignore transient empties, merge by key (defensive against partial snapshots).
	if (next.length === 0 && prev.length > 0) return prev
	const byKey = new Map<string, JazzRow>()
	for (const row of prev) byKey.set(rowKey(row), row)
	for (const row of next) byKey.set(rowKey(row), row)
	return [...byKey.values()]
}

export type JazzStore = {
	readonly rows: JazzRow[]
	readonly loaded: boolean
	readonly error: string | undefined

	get(id: string): Promise<JazzRow>
	create(values: Record<string, unknown>): Promise<JazzRow>
	update(id: string, patch: Record<string, unknown>): Promise<JazzRow>
	delete(id: string): Promise<void>
}

type InternalPool = {
	refs: number
	store: JazzStore
	destroy: () => void
}

const pools = new Map<string, InternalPool>()

function createTablePool(table: string): InternalPool {
	let rows = $state<JazzRow[]>([])
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
			if (!get(grooveSessionReady) || !get(jazzShell).ready) {
				await withTimeoutMs(
					Promise.all([
						waitForGrooveSessionReady(),
						new Promise<void>((resolve) => {
							if (get(jazzShell).ready) {
								resolve()
								return
							}
							const unsub = jazzShell.subscribe((shell) => {
								if (shell.ready) {
									unsub()
									resolve()
								}
							})
							if (get(jazzShell).ready) {
								unsub()
								resolve()
							}
						}),
					]),
					SUBSCRIBE_BUDGET_MS,
					'Groove session ready',
				)
			}
			const u = await withTimeoutMs(
				api.subscribe((next) => {
					if (!alive) return
					const merged = applySnapshotRows(table, rows, next)
					if (!rowsEqual(rows, merged)) rows = merged
					loaded = true
				}),
				SUBSCRIBE_BUDGET_MS,
				`${table} subscribe`,
			)
			if (!alive) {
				u()
				return
			}
			loaded = true
			unlisten = u
			void api.list().then((snap) => {
				if (!alive) return
				const merged = applySnapshotRows(table, rows, snap)
				if (!rowsEqual(rows, merged)) rows = merged
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

	const store: JazzStore = {
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
		async create(values: Record<string, unknown>) {
			const row = await api.create(values)
			if (!alive) return row
			const ix = rows.findIndex((r) => r.id === row.id)
			if (ix >= 0) {
				rows = rows.map((r, i) => (i === ix ? row : r))
			} else {
				rows = [...rows, row]
			}
			loaded = true
			return row
		},
		async update(id: string, patch: Record<string, unknown>) {
			const row = await api.update(id, patch)
			if (!alive) return row
			rows = rows.map((r) => (r.id === id ? row : r))
			loaded = true
			return row
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
export function jazzStore(table: string): JazzStore {
	let pool = pools.get(table)
	if (!pool) {
		pool = createTablePool(table)
		pools.set(table, pool)
	}

	pool.refs++
	onDestroy(() => {
		pool!.refs--
		if (pool!.refs <= 0) {
			pool!.destroy()
			pools.delete(table)
		}
	})

	return pool.store
}
