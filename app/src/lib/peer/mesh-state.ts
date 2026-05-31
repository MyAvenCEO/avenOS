/** Per trusted peer-pair — matches Rust `PeerMeshPhase`. */
import { t } from '$lib/i18n'

export type PeerMeshPhase = 'pairing' | 'offline' | 'searching' | 'syncing' | 'ready'

export type PeerUsability = 'unavailable' | 'connecting' | 'liveSyncing' | 'usable'

export type PeerSyncBlockReason =
	| 'muxPending'
	| 'policyPending'
	| 'catchupPending'

export type SyncBootstrapPhase =
	| 'transportPending'
	| 'shellPending'
	| 'trustPending'
	| 'ready'

export type LinkHealth = 'none' | 'half' | 'full'

export type P2pDiagnostics = {
	centralMode: boolean
	dhtBootstrap: string
	joinedTopicCount: number
	allowlistCount: number
	linkedCount: number
	/** `true` while a 6-char invite code is active on this device (host or acceptor). */
	pairingSessionActive?: boolean
	/** Lowercase hex of the active short-lived pair topic (matches across host + acceptor). */
	pairingTopicHex?: string | null
	lastPathChangeAtMs?: number | null
	lastForegroundHealAtMs?: number | null
	healInProgress?: boolean
	/** Last NWPathMonitor interfaces (e.g. wifi, cellular). */
	networkInterfaces?: string[]
	/** Mux + outbound send path agreement (`none` | `half` | `full`). */
	linkHealth?: LinkHealth
	/** Relay-only data plane (always true). */
	preferRelayOnly?: boolean
}

export type PeerConnectSubstate =
	| 'discovering'
	| 'handshaking'
	| 'relayPairing'

export type PeerTransportMode = 'lan' | 'direct' | 'punched' | 'relay'

export type PeerMeshPeerState = {
	id: string
	peerDid: string
	deviceLabel: string
	dbStatus: string
	addedAtMs: number
	phase: PeerMeshPhase
	usability?: PeerUsability | null
	connectSubstate?: PeerConnectSubstate | null
	transportMode?: PeerTransportMode | null
	reconnectAttempt?: number | null
	lastDisconnectAtMs?: number | null
	lastDisconnectReason?: string | null
	/** Groove mux worker + outbound channel ready. */
	grooveMuxReady?: boolean | null
	/** Biscuit ACL loaded and Groove P2P client registered. */
	syncReady?: boolean | null
	/** Outbound catch-up finished for this peer. */
	catchupReady?: boolean | null
	/** Why phase is syncing (mux / policy / catch-up). */
	syncBlockReason?: PeerSyncBlockReason | null
	/** Shell/trust bootstrap before spark data may flow. */
	bootstrap?: SyncBootstrapPhase | null
}

/** Single source of truth for P2P mesh UI (header + Self → Peers). */
export type PeerMeshStatusReply = {
	hyperswarmRunning: boolean
	hyperswarmStartError?: string | null
	localPkPrefixHex: string
	pairingCodePending?: string | null
	p2pDiagnostics: P2pDiagnostics
	peers: PeerMeshPeerState[]
}

export function peerMeshPhaseLabel(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'pairing':
			return 'PAIRING'
		case 'offline':
			return 'OFFLINE'
		case 'searching':
			return 'SEARCHING'
		case 'syncing':
			return 'SYNCING'
		case 'ready':
			return 'READY'
	}
}

/** User-facing chip text (technical labels stay on `peerMeshPhaseLabel`). */
export function peerMeshPhaseUserLabel(
	phase: PeerMeshPhase,
	usability?: PeerUsability | null,
	opts?: { linkHealth?: LinkHealth | null },
): string {
	switch (peerMeshDisplayPhase(phase, usability, opts)) {
		case 'pairing':
			return t('peer.phaseUser.pairing')
		case 'offline':
			return t('peer.phaseUser.offline')
		case 'searching':
			return t('peer.phaseUser.searching')
		case 'syncing':
			return t('peer.phaseUser.syncing')
		case 'ready':
			return t('peer.phaseUser.ready')
	}
}

export function peerMeshPhaseAnimating(phase: PeerMeshPhase): boolean {
	return phase === 'pairing' || phase === 'searching' || phase === 'syncing'
}

/** Phase for chips — never show “up to date” unless backend says usable. */
export function peerMeshDisplayPhase(
	phase: PeerMeshPhase,
	usability?: PeerUsability | null,
	opts?: { linkHealth?: LinkHealth | null },
): PeerMeshPhase {
	if (opts?.linkHealth === 'half' || opts?.linkHealth === 'none') {
		if (phase === 'ready') return 'searching'
	}
	if (usability && usability !== 'usable') {
		if (phase === 'ready') {
			return usability === 'connecting' ? 'searching' : 'syncing'
		}
	}
	return phase
}

/** Compact label for the left rail badge in the peers list. */
export function peerMeshShortLabel(
	phase: PeerMeshPhase,
	opts?: {
		usability?: PeerUsability | null
		syncBlockReason?: PeerSyncBlockReason | null
		linkHealth?: LinkHealth | null
	},
): string {
	const display = peerMeshDisplayPhase(phase, opts?.usability, {
		linkHealth: opts?.linkHealth,
	})
	switch (display) {
		case 'pairing':
			return 'PAIR'
		case 'offline':
			return 'OFF'
		case 'searching':
			return 'CONN'
		case 'syncing':
			return 'SYNC'
		case 'ready':
			return 'OK'
	}
}

export function peerMeshDotClass(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'offline':
			return 'bg-[var(--color-status-error-base)]'
		case 'pairing':
			return 'bg-[var(--color-status-pairing-base)] animate-pulse'
		case 'searching':
			return 'bg-[var(--color-status-info-base)] animate-pulse'
		case 'syncing':
			return 'bg-[var(--color-status-working-base)] animate-pulse'
		case 'ready':
			return 'bg-[var(--color-status-success-base)]'
	}
}

export function peerMeshTextClass(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'offline':
			return 'text-[var(--color-status-error-base)]'
		case 'pairing':
			return 'text-[var(--color-status-pairing-base)]'
		case 'searching':
			return 'text-[var(--color-status-info-base)]'
		case 'syncing':
			return 'text-[var(--color-status-working-base)]'
		case 'ready':
			return 'text-[var(--color-status-success-base)]'
	}
}

/** Border + tinted background for header chips / pills (readable name uses neutral foreground separately). */
function peerMeshPillSurfaceClass(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'offline':
			return 'border border-[color-mix(in_srgb,var(--color-status-error-base)_38%,transparent)] bg-[color-mix(in_srgb,var(--color-status-error-base)_12%,transparent)]'
		case 'pairing':
			return 'border border-[color-mix(in_srgb,var(--color-status-pairing-base)_42%,transparent)] bg-[color-mix(in_srgb,var(--color-status-pairing-base)_16%,transparent)]'
		case 'searching':
			return 'border border-[color-mix(in_srgb,var(--color-status-info-base)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-status-info-base)_14%,transparent)]'
		case 'syncing':
			return 'border border-[color-mix(in_srgb,var(--color-status-working-base)_42%,transparent)] bg-[color-mix(in_srgb,var(--color-status-working-base)_16%,transparent)]'
		case 'ready':
			return 'border border-[color-mix(in_srgb,var(--color-status-success-base)_38%,transparent)] bg-[color-mix(in_srgb,var(--color-status-success-base)_12%,transparent)]'
	}
}

/** Tinted pill (legacy / full-chip): phase text colour + surface. Prefer `peerMeshHeaderPillSurfaceClass` when the label is neutral. */
export function peerMeshPillClass(phase: PeerMeshPhase): string {
	return `${peerMeshTextClass(phase)} ${peerMeshPillSurfaceClass(phase)}`
}

/** Compact header chip: tinted border/background only; peer name uses neutral foreground. */
export function peerMeshHeaderPillSurfaceClass(phase: PeerMeshPhase): string {
	return peerMeshPillSurfaceClass(phase)
}

export function peerMeshRailClass(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'offline':
			return 'bg-[color-mix(in_srgb,var(--color-status-error-base)_18%,transparent)] border-[color-mix(in_srgb,var(--color-status-error-base)_32%,transparent)]'
		case 'pairing':
			return 'bg-[color-mix(in_srgb,var(--color-status-pairing-base)_24%,transparent)] border-[color-mix(in_srgb,var(--color-status-pairing-base)_38%,transparent)]'
		case 'searching':
			return 'bg-[color-mix(in_srgb,var(--color-status-info-base)_22%,transparent)] border-[color-mix(in_srgb,var(--color-status-info-base)_34%,transparent)]'
		case 'syncing':
			return 'bg-[color-mix(in_srgb,var(--color-status-working-base)_24%,transparent)] border-[color-mix(in_srgb,var(--color-status-working-base)_36%,transparent)]'
		case 'ready':
			return 'bg-[color-mix(in_srgb,var(--color-status-success-base)_18%,transparent)] border-[color-mix(in_srgb,var(--color-status-success-base)_32%,transparent)]'
	}
}

function normalizePeerDid(peerDid: string | undefined | null): string {
	return typeof peerDid === 'string' ? peerDid.trim() : ''
}

/** Lookup a trusted peer row in the live mesh snapshot (canonical phase source). */
export function meshPeerByDid(
	mesh: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
): PeerMeshPeerState | undefined {
	const did = normalizePeerDid(peerDid)
	if (!mesh || !did) return undefined
	return mesh.peers.find((p) => p.peerDid === did)
}

/** Phase for a trusted peer — prefer mesh snapshot, never re-derive transport state. */
export function meshPeerPhase(
	mesh: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	dbStatus?: string,
): PeerMeshPhase {
	return (
		meshPeerByDid(mesh, peerDid)?.phase ??
		(dbStatus === 'pairing' ? 'pairing' : dbStatus === 'active' ? 'searching' : 'offline')
	)
}

export function findPeerMeshPhase(
	status: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	dbStatus?: string,
): PeerMeshPhase {
	return meshPeerPhase(status, peerDid, dbStatus)
}

/** Granular connect sub-label while parent phase is `searching` (Connecting). */
export function peerConnectSubstateLabel(sub: PeerConnectSubstate): string {
	switch (sub) {
		case 'discovering':
			return t('peer.connectSubstate.discovering')
		case 'handshaking':
			return t('peer.connectSubstate.handshaking')
		case 'relayPairing':
			return t('peer.connectSubstate.relayPairing')
	}
}

/** Established transport — relay-only steady state. */
export function peerTransportModeLabel(_mode?: PeerTransportMode | null): string {
	return t('peer.transport.relay')
}

export function peerTransportModeTitle(_mode?: PeerTransportMode | null): string {
	return t('peer.transportTitle.relay')
}

export function peerMeshDetailSubLabel(
	status: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	phase: PeerMeshPhase,
): string | null {
	const row = meshPeerByDid(status, peerDid)
	if (!row) return null
	if (phase === 'searching') {
		if (row.connectSubstate) {
			return peerConnectSubstateLabel(row.connectSubstate)
		}
		if (row.reconnectAttempt && row.reconnectAttempt > 0) {
			const reason = row.lastDisconnectReason
				? row.lastDisconnectReason.replace(/_/g, ' ')
				: t('peer.syncBlock.reconnecting')
			return t('peer.retryAttempt', { attempt: row.reconnectAttempt, reason })
		}
	}
	if ((phase === 'syncing' || phase === 'ready') && row) {
		return peerTransportModeLabel(null)
	}
	if (phase === 'searching' || phase === 'syncing') {
		const reason = row.syncBlockReason
		if (reason === 'muxPending') return t('peer.syncBlock.muxPending')
		if (reason === 'policyPending') return t('peer.syncBlock.policyPending')
		if (reason === 'catchupPending') return t('peer.syncBlock.catchupPending')
		const parts: string[] = []
		if (row.grooveMuxReady === false) parts.push('mux pending')
		if (row.grooveMuxReady === true && row.syncReady === false) parts.push('policy pending')
		if (row.grooveMuxReady === true && row.catchupReady === false) parts.push('catch-up pending')
		if (parts.length > 0) return parts.join(' · ')
	}
	if (
		status?.p2pDiagnostics.linkHealth === 'half' &&
		(phase === 'searching' || phase === 'syncing')
	) {
		return t('peer.syncBlock.halfLinked')
	}
	return null
}

export function peerMeshDetailSubTitle(
	status: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	phase: PeerMeshPhase,
): string | null {
	if (phase === 'syncing' || phase === 'ready') {
		return peerTransportModeTitle(null)
	}
	return null
}
