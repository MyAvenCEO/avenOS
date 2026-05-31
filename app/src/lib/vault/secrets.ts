import { invoke } from '@tauri-apps/api/core'

export type SecretListEntry = {
	id: string
}

export async function secretsList(): Promise<SecretListEntry[]> {
	return invoke<SecretListEntry[]>('plugin:vault|secrets_list')
}

export async function secretsSet(id: string, value: string): Promise<void> {
	await invoke<void>('plugin:vault|secrets_set', { payload: { id, value } })
}

export async function secretsReveal(id: string): Promise<string> {
	return invoke<string>('plugin:vault|secrets_reveal', { payload: { id } })
}

export async function secretsDelete(id: string): Promise<void> {
	await invoke<void>('plugin:vault|secrets_delete', { payload: { id } })
}
