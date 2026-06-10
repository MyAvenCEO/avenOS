import { browser } from '$app/environment'
import { derived, get } from 'svelte/store'
import { deviceSession } from '$lib/settings/device-session-store'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import type { PeerRowReply } from '$lib/peer/api'
import type { PeerMeshPeerState } from '$lib/peer/mesh-state'
import { grooveSessionReady, peerMeshSnapshot, peerMeshStatus } from '$lib/runtime/groove-runtime'

export { peerMeshSnapshot } from '$lib/runtime/groove-runtime'

function meshPeerToRow(p: PeerMeshPeerState): PeerRowReply {
	return {
		id: p.id,
		signerDid: p.signerDid,
		deviceLabel: p.deviceLabel,
		kind: 'remote',
		addedAtMs: p.addedAtMs,
		status: p.dbStatus,
	}
}

/** Trusted remote peers — derived from the live mesh snapshot. */
export const peerRows = derived(peerMeshSnapshot, ($mesh) =>
	($mesh?.peers ?? []).map(meshPeerToRow),
)

let storeGeneration = 0

/** Seed the snapshot from the real `meshStatus` IPC; the `avenos:runtime`
 *  `{ kind: 'mesh' }` event keeps it fresh afterward. */
async function hydrateMesh(gen: number): Promise<void> {
	try {
		const snap = await peerMeshStatus()
		if (gen === storeGeneration) peerMeshSnapshot.set(snap)
	} catch {
		/* backend not ready yet — the runtime mesh event will populate it */
	}
}

/**
 * Live mesh store: seed from `meshStatus` at unlock, then track the runtime
 * `{ kind: 'mesh' }` events (real trusted-peer rows + transport registration).
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
		void hydrateMesh(gen)
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
