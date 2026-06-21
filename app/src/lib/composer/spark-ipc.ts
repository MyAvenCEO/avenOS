// Thin typed wrappers over the scoped sparks filesystem IPC (Rust: src-tauri/src/sparks.rs).
// All access is constrained server-side to `<app_base>/sparks/<sparkId>/`.
import { invoke } from '@tauri-apps/api/core'

export type SparkFile = { path: string; size: number }

export const sparksList = () => invoke<string[]>('sparks_list')
export const sparkListFiles = (sparkId: string) => invoke<SparkFile[]>('spark_list_files', { sparkId })
export const sparkReadFile = (sparkId: string, path: string) =>
	invoke<string>('spark_read_file', { sparkId, path })
export const sparkWriteFile = (sparkId: string, path: string, content: string) =>
	invoke<void>('spark_write_file', { sparkId, path, content })
export const sparkDeleteFile = (sparkId: string, path: string) =>
	invoke<void>('spark_delete_file', { sparkId, path })
