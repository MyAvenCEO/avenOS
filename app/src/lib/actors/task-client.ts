import { RemoteTaskRepository, TaskRequestError } from '@avenos/productivity/remote'
import { invoke, isTauri } from '@tauri-apps/api/core'

export interface TaskSession {
	scope: string
	subjectId: string
	repository: RemoteTaskRepository
}
export async function taskSession(): Promise<TaskSession> {
	if (!isTauri()) throw Error('Open the desktop client to use saved tasks.')
	const context = await invoke<{ scope: string; subjectId: string }>('task_context')
	return {
		...context,
		repository: new RemoteTaskRepository(context.subjectId, async (method, path, body) => {
			try {
				return await invoke('task_request', { scope: context.scope, method, path, body })
			} catch (error) {
				let failure: { code?: string; message?: string; status?: number } = {}
				try {
					failure = JSON.parse(String(error))
				} catch {}
				if (failure.code === 'TASK_RECEIPT_NOT_FOUND') return null
				if (failure.code && failure.status)
					throw new TaskRequestError(
						failure.message ?? 'Task request failed.',
						failure.code,
						failure.status
					)
				throw Error(failure.message ?? String(error))
			}
		})
	}
}
