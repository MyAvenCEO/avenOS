import { browser } from '$app/environment'
import { derived, get } from 'svelte/store'
import { deviceSession } from '$lib/self/device-session-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerRowReply } from '$lib/peer/api'
import { grooveRuntime } from '$lib/runtime/groove-ipc'
import {
	grooveSessionReady,
	peerMeshSnapshot,
	peerMeshStatus,
} from '$lib/runtime/groove-runtime'
import { getTableRowsStore } from '$lib/runtime/table-stores'

export { peerMeshSnapshot } from '$lib/runtime/groove-runtime'

/** Trusted peer rows — pushed via `avenos:runtime` `{ kind: 'table', table: 'peers' }`. */
export const peerRows = derived(getTableRowsStore('peers'), ($rows) => $rows as PeerRowReply[])

let storeGeneration = 0
let peersSubscribed = false

async function subscribePeersTable(): Promise<void> {
	if (peersSubscribed) return
	peersSubscribed = true
	await grooveRuntime('subscribe', { table: 'peers' })
}

async function unsubscribePeersTable(): Promise<void> {
	if (!peersSubscribed) return
	peersSubscribed = false
	await grooveRuntime('unsubscribe', { table: 'peers' })
	getTableRowsStore('peers').set([])
}

async function hydrateMeshOnce(): Promise<void> {
	if (get(deviceSession).kind !== 'unlocked') return
	try {
		peerMeshSnapshot.set(await peerMeshStatus())
	} catch {
		peerMeshSnapshot.set(undefined)
	}
}

/**
 * Push-only peer mesh store: one hydrate at unlock, then `avenos:runtime` updates only.
 * Peers table rows arrive on the same runtime channel (`kind: 'table'`).
 */
export function startPeerMeshStore(): () => void {
	if (!browser || !isTauriRuntime()) {
		return () => {}
	}

	const gen = ++storeGeneration

	const boot = async () => {
		if (gen !== storeGeneration) return
		if (get(deviceSession).kind !== 'unlocked' || !get(grooveSessionReady)) return
		await hydrateMeshOnce()
		if (gen !== storeGeneration) return
		await subscribePeersTable()
	}

	void boot()

	const stopSession = deviceSession.subscribe((s) => {
		if (gen !== storeGeneration) return
		if (s.kind !== 'unlocked') {
			peerMeshSnapshot.set(undefined)
			void unsubscribePeersTable()
			return
		}
		if (get(grooveSessionReady)) void boot()
	})

	const stopReady = grooveSessionReady.subscribe((ready) => {
		if (gen !== storeGeneration) return
		if (ready && get(deviceSession).kind === 'unlocked') void boot()
	})

	return () => {
		if (gen !== storeGeneration) return
		storeGeneration += 1
		stopSession()
		stopReady()
		peerMeshSnapshot.set(undefined)
		void unsubscribePeersTable()
	}
}
