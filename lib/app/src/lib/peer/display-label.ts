/** Truncate a `did:key:…` for compact UI. */
export function shortPeerDid(did: string): string {
	const t = did.trim()
	return t.length > 32 ? `${t.slice(0, 18)}…${t.slice(-8)}` : t
}

/**
 * Peers paired before label exchange stored our own advertised name in `deviceLabel`.
 * If `storedLabel` matches this device's pairing label, show the DID instead.
 */
export function peerDisplayLabel(
	peerDid: string,
	storedLabel: string | undefined,
	localPairingLabel: string | undefined,
): string {
	const stored = storedLabel?.trim()
	if (!stored) return shortPeerDid(peerDid)
	const local = localPairingLabel?.trim().toLowerCase()
	if (local && stored.toLowerCase() === local) return shortPeerDid(peerDid)
	return stored
}
