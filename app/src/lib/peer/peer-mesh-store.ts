import { browser } from '$app/environment'
import { derived, get } from 'svelte/store'
import { deviceSession } from '$lib/settings/device-session-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { demoPeerRows, getDemoMeshStatus, type PeerRowReply } from '$lib/peer/api'
import type { PeerMeshPeerState } from '$lib/peer/mesh-state'
import { grooveSessionReady, peerMeshSnapshot } from '$lib/runtime/groove-runtime'

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

/** Trusted remote peers — demo mesh only. */
export const peerRows = derived(peerMeshSnapshot, ($mesh) =>
	($mesh?.peers ?? []).map(meshPeerToRow),
)

/** Demo rows when mesh snapshot is not yet hydrated. */
export const demoPeerRowsStore = derived([], () => demoPeerRows())

let storeGeneration = 0

function hydrateDemoMesh(): void {
	peerMeshSnapshot.set(getDemoMeshStatus())
}

/**
 * Demo mesh store: hydrate once at unlock with hardcoded peers.
 */
export function startPeerMeshStore(): () => void {
	if (!browser || !isTauriRuntime()) {
		return () => {}
	}

	const gen = ++storeGeneration

	const boot = () => {
		if (gen !== storeGeneration) return
		if (get(deviceSession).kind !== 'unlocked') return
		if (!get(grooveSessionReady)) return
		hydrateDemoMesh()
	}

	void boot()

	const stopSession = deviceSession.subscribe((s) => {
		if (gen !== storeGeneration) return
		if (s.kind !== 'unlocked') {
			peerMeshSnapshot.set(undefined)
			return
		}
		if (get(grooveSessionReady)) boot()
	})

	const stopReady = grooveSessionReady.subscribe((ready) => {
		if (gen !== storeGeneration) return
		if (ready && get(deviceSession).kind === 'unlocked') boot()
	})

	return () => {
		if (gen !== storeGeneration) return
		storeGeneration += 1
		stopSession()
		stopReady()
		peerMeshSnapshot.set(undefined)
	}
}
