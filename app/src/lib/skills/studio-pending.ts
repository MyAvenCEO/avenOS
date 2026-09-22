type Command = Record<string, unknown>
type Operation = 'start' | 'connect'
const storageKey = (workspace: string, operation: Operation) =>
	`studio.pending/${workspace}/${operation}`

/** Admission receipts only, never a local program store. Retain uncertain commands
 * across navigation/restart so checking them cannot accidentally start new work. */
export function readPendingStudio(workspace: string, operation: Operation): Command | null {
	const raw = localStorage.getItem(storageKey(workspace, operation))
	if (raw === null) return null
	const value = JSON.parse(raw)
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		typeof value[operation === 'start' ? 'requestId' : 'id'] !== 'string'
	)
		throw Error(
			'The previous request could not be restored. Check Activity before starting more work.'
		)
	return value
}

export function savePendingStudio(
	workspace: string,
	operation: Operation,
	command: Command | null
) {
	if (!workspace) throw Error('Wait for the workspace to load before starting work.')
	const key = storageKey(workspace, operation)
	if (command === null) localStorage.removeItem(key)
	else localStorage.setItem(key, JSON.stringify(command))
}
