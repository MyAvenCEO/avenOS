import { invoke } from '@tauri-apps/api/core'

export type SelfStoragePathsReply = {
	/** Active identity root (`…/identities/<slug>`). */
	root: string
	/** AvenOS app data root (`…/.avenOS`). */
	appBase: string
	dbDir: string
	selfIdentityDir: string
}

export async function selfStoragePaths(): Promise<SelfStoragePathsReply> {
	return invoke<SelfStoragePathsReply>('self_storage_paths')
}

/** Removes avenDB/SurrealKV under the active vault only; identity is preserved. */
export async function selfClearAvenDbDatabase(): Promise<void> {
	await invoke<void>('self_clear_avendb_database')
}

/** Deletes the entire `.avenOS` tree (all vaults, identity, schema cache) and locks the app. */
export async function selfClearAvenOsData(): Promise<void> {
	await invoke<void>('self_clear_aven_os_data')
}
