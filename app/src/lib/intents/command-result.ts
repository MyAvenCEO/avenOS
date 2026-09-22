import { ActorCommandRejected } from '@avenos/actors'

/** Only the trusted Intent command transport belongs here, never tool/document text.
 * The service emits this exact conflict after a conditional write changed no rows.
 * A lost acknowledgement, generic 409 or malformed response remains uncertain. */
export async function runIntentCommand<T>(
	execute: () => Promise<T>,
	refresh: () => Promise<unknown>
): Promise<T> {
	try {
		return await execute()
	} catch (error) {
		let failure: Record<string, unknown> | undefined
		try {
			if (typeof error === 'string') failure = JSON.parse(error)
		} catch {}
		if (
			!failure ||
			failure.code !== 'INTENT_VERSION_CONFLICT' ||
			failure.status !== 409 ||
			failure.retryable !== false ||
			typeof failure.message !== 'string'
		)
			throw error
		let refreshed = false
		try {
			await refresh()
			refreshed = true
		} catch {}
		throw new ActorCommandRejected(
			`Not applied: the Intent changed before this command could be saved. ${
				refreshed ? 'Its current state has been refreshed.' : 'Read its current state first.'
			} Reconsider whether the user still needs this change. Opening an archived Intent does not require restoring it.`
		)
	}
}
