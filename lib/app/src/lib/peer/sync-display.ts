import type { PeerTransportStatusReply } from '$lib/peer/api'

/** Mesh connectivity shown in the header badge and Self sidebar. */
export type PeerSyncPhase = 'offline' | 'pairing' | 'connected'

export function derivePeerSyncPhase(
	st: PeerTransportStatusReply,
	allowlistedActive: number,
	options?: { forcePairing?: boolean },
): PeerSyncPhase {
	if (options?.forcePairing || st.pairingCodePending) return 'pairing'
	if (st.linkedPeerIds.length > 0) return 'connected'
	if (allowlistedActive > 0 && st.hyperswarmRunning) return 'pairing'
	return 'offline'
}

export function peerSyncLabel(phase: PeerSyncPhase): string {
	switch (phase) {
		case 'offline':
			return 'OFFLINE'
		case 'pairing':
			return 'PAIRING'
		case 'connected':
			return 'CONNECTED'
	}
}

export function peerSyncDotClass(phase: PeerSyncPhase): string {
	switch (phase) {
		case 'offline':
			return 'bg-[var(--color-status-error-base)]'
		case 'pairing':
			return 'bg-[var(--color-status-info-base)] animate-pulse'
		case 'connected':
			return 'bg-[var(--color-status-success-base)]'
	}
}

export function peerSyncTextClass(phase: PeerSyncPhase): string {
	switch (phase) {
		case 'offline':
			return 'text-[var(--color-status-error-base)]'
		case 'pairing':
			return 'text-[var(--color-status-info-base)]'
		case 'connected':
			return 'text-[var(--color-status-success-base)]'
	}
}

export function peerRowSyncPhase(status: string, meshPairing: boolean): PeerSyncPhase {
	if (status === 'active') return 'connected'
	if (status === 'pairing' || meshPairing) return 'pairing'
	return 'offline'
}
