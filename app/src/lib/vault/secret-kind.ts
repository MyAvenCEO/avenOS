export type VaultSecretKind = 'passwords' | 'api-keys'

const STORAGE_PREFIX: Record<VaultSecretKind, string> = {
	passwords: 'pw.',
	'api-keys': 'api.',
}

/** Map user-facing id → Stronghold storage id (no `/` allowed). */
export function toStorageId(kind: VaultSecretKind, userId: string): string {
	const id = userId.trim()
	if (!id) return id
	const prefix = STORAGE_PREFIX[kind]
	if (id.startsWith(prefix)) return id
	return `${prefix}${id}`
}

/** Map storage id → label shown in the list. */
export function toDisplayId(kind: VaultSecretKind, storageId: string): string {
	const prefix = STORAGE_PREFIX[kind]
	if (storageId.startsWith(prefix)) return storageId.slice(prefix.length)
	return storageId
}

export function matchesSecretKind(kind: VaultSecretKind, storageId: string): boolean {
	if (storageId.startsWith(STORAGE_PREFIX[kind])) return true
	if (kind === 'passwords') {
		return !storageId.startsWith(STORAGE_PREFIX['api-keys'])
	}
	return false
}

export function vaultSecretTitleKey(kind: VaultSecretKind): 'vaultNav.passwords' | 'vaultNav.apiKeys' {
	return kind === 'passwords' ? 'vaultNav.passwords' : 'vaultNav.apiKeys'
}
