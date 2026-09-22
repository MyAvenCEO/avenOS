import { IntentWorkRequestError, RemoteIntentWork } from '@avenos/intents/remote'
import { turnProgressSchema } from '@avenos/intents/turn-progress'
import { invoke, isTauri } from '@tauri-apps/api/core'

async function request<T>(command: string, args: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(command, args)
	} catch (error) {
		let failure: { code?: string; message?: string; status?: number } = {}
		try {
			failure = JSON.parse(String(error))
		} catch {}
		if (
			typeof failure.code === 'string' &&
			(failure.status === undefined ||
				(Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599))
		)
			throw new IntentWorkRequestError(
				failure.message ?? 'Conversation work request failed.',
				failure.code,
				failure.status
			)
		throw Error(failure.message ?? String(error))
	}
}

/** No local executor fallback. One captured customer scope owns every request. */
export async function intentWorkSession() {
	if (!isTauri()) throw Error('Open the desktop client to use saved conversation work.')
	const context = await invoke<{ scope: string }>('intent_work_context')
	return {
		...context,
		async progress(turnId: string) {
			try {
				const value = turnProgressSchema.parse(
					await request('intent_work_progress', { scope: context.scope, turnId })
				)
				if (value.turnId !== turnId) throw Error('Conversation progress belongs to another turn.')
				return value
			} catch (error) {
				// An admitted turn need not have reached the runner yet. This is not
				// evidence of completion; queue state remains owned by Intent Service.
				if (
					error instanceof IntentWorkRequestError &&
					error.code === 'TURN_PROGRESS_NOT_FOUND' &&
					error.status === 404
				)
					return null
				throw error
			}
		},
		work: new RemoteIntentWork((method, path, body) =>
			request('intent_work_request', { scope: context.scope, method, path, body })
		)
	}
}
