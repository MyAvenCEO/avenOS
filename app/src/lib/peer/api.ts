/** A trusted-peer row as surfaced to peer-picker / talk UIs. */
export type PeerRowReply = {
	id: string
	peerDid: string
	deviceLabel: string
	kind: string
	addedAtMs: number
	status: string
}
