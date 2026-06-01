/** Runtime probe — true inside the AvenOS Tauri shell (desktop), false on web. */
export function isTauriRuntime(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
