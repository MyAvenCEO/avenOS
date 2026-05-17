import { invoke } from '@tauri-apps/api/core'

export type SelfStoragePathsReply = {
	root: string
	dbDir: string
	selfIdentityDir: string
}

export async function selfStoragePaths(): Promise<SelfStoragePathsReply> {
	return invoke<SelfStoragePathsReply>('self_storage_paths')
}

export async function selfClearJazzDatabase(): Promise<void> {
	await invoke<void>('self_clear_jazz_database')
}
