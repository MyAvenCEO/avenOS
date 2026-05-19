import { invoke } from '@tauri-apps/api/core'

export type VaultListEntry = {
	usernameSlug: string
	firstName?: string
	deviceLabel?: string
	hasIdentityBlob: boolean
}

export async function vaultList(): Promise<VaultListEntry[]> {
	return invoke<VaultListEntry[]>('plugin:self|vault_list')
}

export async function vaultSlugPreview(firstName: string): Promise<string> {
	return invoke<string>('plugin:self|vault_slug_preview', { payload: { firstName } })
}

export async function vaultSelect(usernameSlug: string): Promise<void> {
	await invoke('plugin:self|vault_select', { slug: usernameSlug })
}

/** Active vault slug in this process (`undefined` until pick/create completes). */
export async function vaultSelectedSlug(): Promise<string | undefined> {
	const slug = await invoke<string | null>('plugin:self|vault_selected_slug')
	return slug ?? undefined
}

export type VaultCreateReply = {
	usernameSlug: string
}

export async function vaultCreate(firstName: string, deviceLabel: string): Promise<VaultCreateReply> {
	return invoke<VaultCreateReply>('plugin:self|vault_create', {
		firstName,
		deviceLabel,
	})
}

function titleCaseFromSlug(slug: string): string {
	if (!slug.trim()) return slug
	const w = slug.split(/[\s_-]+/).filter(Boolean)
	if (w.length === 1 && w[0]) {
		return w[0].charAt(0).toUpperCase() + w[0].slice(1).toLowerCase()
	}
	return w.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

/** Card title before unlock uses firstName, else a title-cased slug. */
export function vaultCardTitle(entry: VaultListEntry): string {
	if (entry.firstName?.trim()) return entry.firstName.trim()
	return titleCaseFromSlug(entry.usernameSlug)
}
