/** Exercise the bundled production client, not a second HTTP admission adapter. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { IntentWorkRequestError, type RemoteIntentWork } from '../../libs/aven-intents/src/remote'
import type { TurnProgress } from '../../libs/aven-intents/src/turn-progress'
import type { TauriSession } from './tauri-driver'

export function nativeIntentWork(session: () => TauriSession) {
	const call = async (method: string, args: unknown[] = []): Promise<any> => {
		const current = session()
		const key = `__avenWorkProbe_${randomUUID()}`
		await current.execute(
			`const [key, method, args] = arguments;
			const run = async () => {
				if (method === 'connect') {
					window.__avenBackgroundWork = await window.__avenWorkday.intentWorkSession();
					return window.__avenBackgroundWork.scope;
				}
				if (method === 'policy') {
					return window.__TAURI_INTERNALS__.invoke('intent_work_request', args[0]);
				}
				if (method === 'progress-policy') {
					return window.__TAURI_INTERNALS__.invoke('intent_work_progress', args[0]);
				}
				if (method === 'progress') return window.__avenBackgroundWork.progress(...args);
				return window.__avenBackgroundWork.work[method](...args);
			};
			run().then(value => window[key] = {ok: true, value}, error => window[key] = {
				ok: false, failure: {message: String(error), code: error?.code, status: error?.status}
			});`,
			[key, method, args]
		)
		try {
			const deadline = Date.now() + 65_000
			while (Date.now() < deadline) {
				const result = await current.execute<any>('return window[arguments[0]] ?? null', [key])
				if (result) {
					if (!result.ok) {
						if (typeof result.failure?.code === 'string')
							throw new IntentWorkRequestError(
								result.failure.message,
								result.failure.code,
								result.failure.status
							)
						throw Error(result.failure?.message ?? 'Native work failed.')
					}
					return result.value
				}
				await sleep(100)
			}
			throw Error(`Native work ${method} did not finish. Its outcome is unknown; do not replay it.`)
		} finally {
			await current.execute('delete window[arguments[0]]', [key])
		}
	}
	let pinned: string | undefined
	return {
		async connect() {
			const deadline = Date.now() + 30_000
			while (!(await session().execute('return !!window.__avenWorkday?.intentWorkSession'))) {
				if (Date.now() >= deadline) throw Error('The native work client fixture did not mount.')
				await sleep(100)
			}
			const scope = await call('connect')
			assert.equal(typeof scope, 'string')
			assert(scope.length > 0)
			if (pinned)
				assert.equal(scope, pinned, 'The new client must use the same customer workspace.')
			pinned = scope
			await assert.rejects(
				call('policy', [
					{ scope: 'different-workspace', method: 'POST', path: '/input', body: {} }
				]),
				/workspace changed/
			)
			await assert.rejects(
				call('policy', [{ scope, method: 'GET', path: '/arbitrary-route' }]),
				/not available/
			)
			await assert.rejects(
				call('progress-policy', [{ scope: 'another-workspace', turnId: randomUUID() }]),
				/workspace changed/
			)
			await assert.rejects(
				call('progress-policy', [{ scope, turnId: '../runs' }]),
				/Invalid conversation turn/
			)
		},
		progress: (turnId: string): Promise<TurnProgress | null> => call('progress', [turnId]),
		work: {
			admit: (input) => call('admit', [input]),
			receipt: (inputId, revision) => call('receipt', [inputId, revision]),
			turns: (intentId, query) => call('turns', query ? [intentId, query] : [intentId]),
			stop: (intentId, turnId, command) => call('stop', [intentId, turnId, command])
		} satisfies Pick<RemoteIntentWork, 'admit' | 'receipt' | 'turns' | 'stop'>
	}
}
