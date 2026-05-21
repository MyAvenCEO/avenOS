import { invoke } from '@tauri-apps/api/core'
import { grooveRuntime } from '$lib/runtime/groove-ipc'

export type PeerTransportStatusReply = {
	hyperswarmRunning: boolean
	localPkPrefixHex: string
	linkedPeerIds: string[]
	/** Live Hyperswarm links by `did:key` — matches `PeerRowReply.peerDid`. */
	linkedPeerDids: string[]
	pairingCodePending?: string | null
}

export type PeerInviteCreateReply = {
	code: string
}

export async function peerTransportStatus(): Promise<PeerTransportStatusReply> {
	return invoke<PeerTransportStatusReply>('plugin:peer|peer_transport_status')
}

export async function peerInviteCreate(): Promise<PeerInviteCreateReply> {
	return invoke<PeerInviteCreateReply>('plugin:peer|peer_invite_create')
}

export async function peerInviteAccept(code: string): Promise<void> {
	await invoke<void>('plugin:peer|peer_invite_accept', { code })
}

export async function peerInviteCancel(): Promise<void> {
	await invoke<void>('plugin:peer|peer_invite_cancel')
}

export type PeerRowReply = {
	id: string
	peerDid: string
	deviceLabel: string
	kind: string
	addedAtMs: number
	status: string
}

export async function peerList(): Promise<PeerRowReply[]> {
	return grooveRuntime<PeerRowReply[]>('peerList', {})
}

export async function peerRevoke(peerDid: string): Promise<void> {
	await grooveRuntime('peerRevoke', { peerDid })
}
