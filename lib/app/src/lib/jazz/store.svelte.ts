import { onDestroy } from 'svelte'
import { get } from 'svelte/store'
import { browser } from '$app/environment'
import type { SchemaTables } from '@avenos/jazz-schema'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { deviceSession } from '$lib/self/device-session-store'
import { jazzBootstrap, jazzStatus, jazzTable } from './api'

export type JazzTableStore<TName extends keyof SchemaTables> = {
	/** Current snapshot. Empty array until the first publish lands. */
	readonly rows: SchemaTables[TName][]
	/** `true` once the first snapshot (or a terminal error) has been observed. */
	readonly loaded: boolean
	/** Last subscription error, if any. */
	readonly error: string | undefined
}

/**
 * Auto-subscribing Svelte-5 rune store for one Jazz table.
 *
 * The Rust shell owns the data: snapshots arrive over `jazz:<table>:changed` Tauri
 * events on every local CRUD AND on every inbound peer-sync delta (see
 * `ManagedJazz::run_table_change_drain`). Components do not need to re-fetch on user
 * interaction — keystrokes, focus changes, navigation, etc. are decoupled from data
 * freshness.
 *
 * Lifecycle:
 *   - Subscribes lazily after `deviceSession` is unlocked (Touch-ID or dev bypass).
 *   - Resubscribes if the vault locks then unlocks again (rows reset to `[]` first
 *     so stale data doesn't leak across identities).
 *   - Tears down on component destroy.
 *
 * MUST be called from a component's `<script>` initialisation (uses `onDestroy`).
 */
export function jazzTableStore<TName extends keyof SchemaTables>(
	table: TName,
): JazzTableStore<TName> {
	type Row = SchemaTables[TName]

	let rows = $state<Row[]>([])
	let loaded = $state(false)
	let error = $state<string | undefined>()

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
			const u = await jazzTable(table).subscribe((next) => {
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

	// Re-subscribe across vault lock/unlock so a fresh identity starts from a clean
	// snapshot instead of inheriting the previous one. `deviceSession.subscribe` fires
	// once eagerly with the current value; skip that first fire.
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
	}
}
