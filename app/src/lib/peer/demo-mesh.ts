/** Hardcoded demo mesh — shows Connecting / Syncing / OK user-facing states. */

export type SyncBootstrapPhase =
	| 'transportPending'
	| 'shellPending'
	| 'trustPending'
	| 'ready'

export type DemoMeshPeer = {
	id: string
	peerDid: string
	deviceLabel: string
	dbStatus: string
	addedAtMs: number
	/** Internal phase — mapped to user labels in mesh-state.ts */
	phase: 'searching' | 'syncing' | 'ready'
	bootstrap: SyncBootstrapPhase
}

export type DemoMeshSnapshot = {
	localPkPrefixHex: string
	peers: DemoMeshPeer[]
}

const now = Date.now()

export const DEMO_MESH_SNAPSHOT: DemoMeshSnapshot = {
	localPkPrefixHex: 'demo0000',
	peers: [
		{
			id: 'demo-connecting',
			peerDid: 'did:key:z6MkDemoConnecting',
			deviceLabel: "Jamie's MacBook",
			dbStatus: 'active',
			addedAtMs: now - 120_000,
			phase: 'searching',
			bootstrap: 'transportPending',
		},
		{
			id: 'demo-syncing',
			peerDid: 'did:key:z6MkDemoSyncing',
			deviceLabel: "Jamie's iPhone",
			dbStatus: 'active',
			addedAtMs: now - 300_000,
			phase: 'syncing',
			bootstrap: 'ready',
		},
		{
			id: 'demo-ok',
			peerDid: 'did:key:z6MkDemoOk',
			deviceLabel: 'Studio iPad',
			dbStatus: 'active',
			addedAtMs: now - 86_400_000,
			phase: 'ready',
			bootstrap: 'ready',
		},
	],
}
