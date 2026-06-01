import type { DemoMeshSnapshot, DemoMeshPeer } from './demo-mesh'
import { DEMO_MESH_SNAPSHOT } from './demo-mesh'
import type { PeerMeshPeerState, PeerMeshStatusReply } from './mesh-state'

function demoPeerToMeshState(p: DemoMeshPeer): PeerMeshPeerState {
	const phase =
		p.phase === 'searching'
			? 'searching'
			: p.phase === 'syncing'
				? 'syncing'
				: p.phase === 'ready'
					? 'ready'
					: 'offline'

	return {
		id: p.id,
		peerDid: p.peerDid,
		deviceLabel: p.deviceLabel,
		dbStatus: p.dbStatus,
		addedAtMs: p.addedAtMs,
		phase,
		usability:
			phase === 'ready' ? 'usable' : phase === 'syncing' ? 'liveSyncing' : 'connecting',
		bootstrap: p.bootstrap,
	}
}

export function demoMeshToStatusReply(snap: DemoMeshSnapshot): PeerMeshStatusReply {
	return {
		hyperswarmRunning: false,
		localPkPrefixHex: snap.localPkPrefixHex,
		p2pDiagnostics: {
			centralMode: false,
			dhtBootstrap: 'demo (local-only)',
			joinedTopicCount: 0,
			allowlistCount: snap.peers.length,
			linkedCount: snap.peers.filter((p) => p.phase === 'ready').length,
			pairingSessionActive: false,
			preferRelayOnly: true,
			linkHealth: 'none',
		},
		peers: snap.peers.map(demoPeerToMeshState),
	}
}

/** Client-side demo mesh — no live transport. */
export function getDemoMeshStatus(): PeerMeshStatusReply {
	return demoMeshToStatusReply(DEMO_MESH_SNAPSHOT)
}

export type PeerRowReply = {
	id: string
	peerDid: string
	deviceLabel: string
	kind: string
	addedAtMs: number
	status: string
}

export function demoPeerRows(): PeerRowReply[] {
	return DEMO_MESH_SNAPSHOT.peers.map((p) => ({
		id: p.id,
		peerDid: p.peerDid,
		deviceLabel: p.deviceLabel,
		kind: 'remote',
		addedAtMs: p.addedAtMs,
		status: p.dbStatus,
	}))
}

export async function peerMeshStatus(): Promise<PeerMeshStatusReply> {
	return getDemoMeshStatus()
}

export async function peerRevoke(_peerDid: string): Promise<void> {}

