import { browser } from '$app/environment'
import { derived, get } from 'svelte/store'
import { deviceSession } from '$lib/settings/device-session-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerRowReply } from '$lib/peer/api'
import type { PeerMeshPeerState } from '$lib/peer/mesh-state'
import {
	grooveSessionReady,
	peerMeshSnapshot,
	peerMeshStatus,
} from '$lib/runtime/groove-runtime'

export { peerMeshSnapshot } from '$lib/runtime/groove-runtime'

function meshPeerToRow(p: PeerMeshPeerState): PeerRowReply {
	return {
		id: p.id,
		peerDid: p.peerDid,
		deviceLabel: p.deviceLabel,
		kind: 'remote',
		addedAtMs: p.addedAtMs,
		status: p.dbStatus,
	}
}

/** Trusted remote peers — derived from mesh snapshot (same source as header badge). */
export const peerRows = derived(peerMeshSnapshot, ($mesh) =>
	($mesh?.peers ?? []).map(meshPeerToRow),
)

let storeGeneration = 0

async function hydrateMeshOnce(): Promise<void> {
	if (get(deviceSession).kind !== 'unlocked') return
	try {
		peerMeshSnapshot.set(await peerMeshStatus())
	} catch {
		peerMeshSnapshot.set(undefined)
	}
}

/**
 * Push-only peer mesh store: one hydrate at unlock, then `avenos:runtime` mesh updates only.
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
	}

	void boot()

	const stopSession = deviceSession.subscribe((s) => {
		if (gen !== storeGeneration) return
		if (s.kind !== 'unlocked') {
			peerMeshSnapshot.set(undefined)
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
	}
}
