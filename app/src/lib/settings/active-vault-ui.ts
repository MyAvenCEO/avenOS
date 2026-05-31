import type { DeviceSession } from './device-session-store'
import { vaultPairingLabel, vaultCardTitle, type VaultListEntry } from './vault'

/** Rows from `vault_list` keyed by authoritative unlocked identity slug (`active_identity.usernameSlug`). */
export function pickVaultRowForIdentity(
	vaults: VaultListEntry[],
	session: DeviceSession,
): VaultListEntry | undefined {
	if (session.kind !== 'unlocked') return undefined
	const slug = session.identity.usernameSlug
	const row = vaults.find((v) => v.usernameSlug === slug)
	if (row) return row

	/** Rust is pinned — `vault_list` may briefly lag just after onboarding. */
	return {
		usernameSlug: slug,
		firstName: undefined,
		deviceLabel: session.identity.pairingLabel?.trim() ?? undefined,
		hasIdentityBlob: true,
	}
}

export function displayTitleForSession(vaults: VaultListEntry[], session: DeviceSession): string {
	if (session.kind === 'locked') return 'Self'
	const row = pickVaultRowForIdentity(vaults, session)
	return row ? vaultCardTitle(row) : session.identity.usernameSlug
}

export function pairingLabelForSession(
	vaults: VaultListEntry[],
	session: DeviceSession,
): string | undefined {
	if (session.kind === 'locked') return undefined
	const row = pickVaultRowForIdentity(vaults, session)
	return row ? vaultPairingLabel(row) : session.identity.pairingLabel ?? undefined
}
