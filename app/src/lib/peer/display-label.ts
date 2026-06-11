/** Truncate a `did:key:…` for compact UI. */
export function shortSignerDid(did: string | undefined): string {
	const t = (did ?? '').trim()
	return t.length > 32 ? `${t.slice(0, 18)}…${t.slice(-8)}` : t
}

/**
 * Peers paired before label exchange stored our own advertised name in `deviceLabel`.
 * If `storedLabel` matches this device's pairing label, show the DID instead.
 */
export function peerDisplayLabel(
	signerDid: string,
	storedLabel: string | undefined,
	localPairingLabel: string | undefined
): string {
	const stored = storedLabel?.trim()
	if (!stored) return shortSignerDid(signerDid)
	const local = localPairingLabel?.trim().toLowerCase()
	if (local && stored.toLowerCase() === local) return shortSignerDid(signerDid)
	return stored
}

/** Person name for compact UI (`firstName/deviceName` pairing label → `firstName` only). */
export function peerPersonName(
	signerDid: string,
	storedLabel: string | undefined,
	localPairingLabel: string | undefined
): string {
	const full = peerDisplayLabel(signerDid, storedLabel, localPairingLabel)
	const slash = full.indexOf('/')
	if (slash > 0) return full.slice(0, slash).trim()
	return full
}

/** Person name + device name for picker rows (`firstName/deviceName` → two lines). */
export function peerPickerLines(
	signerDid: string,
	storedLabel: string | undefined,
	localPairingLabel: string | undefined
): { title: string; device?: string } {
	const full = peerDisplayLabel(signerDid, storedLabel, localPairingLabel)
	const slash = full.indexOf('/')
	if (slash > 0) {
		const title = full.slice(0, slash).trim()
		const device = full.slice(slash + 1).trim()
		return device ? { title, device } : { title }
	}
	return { title: full }
}
