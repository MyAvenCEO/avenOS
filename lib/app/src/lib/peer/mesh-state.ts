/** Per trusted peer-pair — matches Rust `PeerMeshPhase`. */
export type PeerMeshPhase = 'pairing' | 'offline' | 'searching' | 'syncing' | 'ready'

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
}

export type PeerConnectSubstate =
	| 'discovering'
	| 'handshaking'
	| 'holepunching'
	| 'relayFallback'

export type PeerTransportMode = 'lan' | 'direct' | 'punched' | 'relay'

export type PeerMeshPeerState = {
	id: string
	peerDid: string
	deviceLabel: string
	dbStatus: string
	addedAtMs: number
	phase: PeerMeshPhase
	connectSubstate?: PeerConnectSubstate | null
	transportMode?: PeerTransportMode | null
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
export function peerMeshPhaseUserLabel(phase: PeerMeshPhase): string {
	switch (phase) {
		case 'pairing':
			return 'Pairing…'
		case 'offline':
			return 'Offline'
		case 'searching':
			return 'Connecting…'
		case 'syncing':
			return 'Syncing…'
		case 'ready':
			return 'Up to date'
	}
}

export function peerMeshPhaseAnimating(phase: PeerMeshPhase): boolean {
	return phase === 'pairing' || phase === 'searching' || phase === 'syncing'
}

/** Compact label for the left rail badge in the peers list. */
export function peerMeshShortLabel(phase: PeerMeshPhase): string {
	switch (phase) {
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
			return 'Discovering'
		case 'handshaking':
			return 'Handshaking'
		case 'holepunching':
			return 'Holepunching'
		case 'relayFallback':
			return 'Relay fallback'
	}
}

/** Established transport sub-label while parent phase is `syncing` / `ready`. */
export function peerTransportModeLabel(mode: PeerTransportMode): string {
	switch (mode) {
		case 'lan':
			return 'LAN'
		case 'direct':
			return 'Direct'
		case 'punched':
			return 'Punched'
		case 'relay':
			return 'Relay'
	}
}

export function peerTransportModeTitle(mode: PeerTransportMode): string {
	switch (mode) {
		case 'lan':
			return 'Same local network (Wi‑Fi / hotspot)'
		case 'direct':
			return 'Internet, no NAT punch needed'
		case 'punched':
			return 'NAT traversal'
		case 'relay':
			return 'Fallback via Aven relay (encrypted)'
	}
}

export function peerMeshDetailSubLabel(
	status: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	phase: PeerMeshPhase,
): string | null {
	const row = meshPeerByDid(status, peerDid)
	if (!row) return null
	if (phase === 'searching' && row.connectSubstate) {
		return peerConnectSubstateLabel(row.connectSubstate)
	}
	if ((phase === 'syncing' || phase === 'ready') && row.transportMode) {
		return peerTransportModeLabel(row.transportMode)
	}
	return null
}

export function peerMeshDetailSubTitle(
	status: PeerMeshStatusReply | undefined,
	peerDid: string | undefined,
	phase: PeerMeshPhase,
): string | null {
	const row = meshPeerByDid(status, peerDid)
	if (!row?.transportMode) return null
	if (phase === 'syncing' || phase === 'ready') {
		return peerTransportModeTitle(row.transportMode)
	}
	return null
}
