import { onDestroy } from 'svelte'
import { get } from 'svelte/store'
import { browser } from '$app/environment'
import type { SchemaTables } from '@avenos/jazz-schema'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/self/device-session-store'
import { type JazzCreatePayload, jazzBootstrap, jazzStatus, jazzTable } from './api'

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

/** @deprecated Prefer `jazzStore` — same implementation. Will remove after one revision. */
export type JazzTableStore<TName extends keyof SchemaTables> = Pick<
	JazzStore<TName>,
	'rows' | 'loaded' | 'error'
>

/**
 * Svelte 5 handle for **one Jazz table**: reactive snapshot + mutations over the unified
 * `change_tx` drain (local CRUD and peer deltas both converge on `jazz:<table>:changed`).
 *
 * Prefer this over juggling `jazzTable(t).subscribe` separately from `.create`/`.update`.
 *
 * MUST be called from component `<script>` init (uses `onDestroy`).
 */
export function jazzStore<TName extends keyof SchemaTables>(
	table: TName,
): JazzStore<TName> {
	type Row = SchemaTables[TName]

	let rows = $state<Row[]>([])
	let loaded = $state(false)
	let error = $state<string | undefined>()

	const api = jazzTable(table)

	let unlisten: (() => void) | undefined
	let alive = true

	async function start(): Promise<void> {
		if (!browser || !isTauriRuntime()) {
			loaded = true
			return
		}
		const kind = get(deviceSession).kind
		if (kind !== 'unlocked' && kind !== 'dev_bypass') return
		try {
			const status = await jazzStatus()
			if (!status.ready) await jazzBootstrap()
			const u = await api.subscribe((next) => {
				if (!alive) return
				rows = next as Row[]
				loaded = true
			})
			if (!alive) {
				u()
				return
			}
			unlisten = u
		} catch (e) {
			if (!alive) return
			error = e instanceof Error ? e.message : String(e)
			loaded = true
		}
	}

	void start()

	let prevKind: string | null = null
	const stopWatch = deviceSession.subscribe(($s) => {
		const k = $s.kind
		if (prevKind === null) {
			prevKind = k
			return
		}
		if (k === prevKind) return
		prevKind = k
		unlisten?.()
		unlisten = undefined
		rows = []
		loaded = false
		error = undefined
		void start()
	})

	onDestroy(() => {
		alive = false
		unlisten?.()
		stopWatch()
	})

	return {
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
}

/** @deprecated Use [`jazzStore`] */
export function jazzTableStore<TName extends keyof SchemaTables>(
	table: TName,
): JazzStore<TName> {
	return jazzStore(table)
}
