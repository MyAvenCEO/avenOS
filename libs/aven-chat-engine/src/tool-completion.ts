/** Stop waiting without claiming to cancel an already-admitted external action. */
export function awaitToolCompletion<T>(
	work: T | Promise<T>,
	name: string,
	signal?: AbortSignal
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() =>
				finish(() =>
					reject(
						Error(
							`No completion received from ${name}. Its outcome is unknown; inspect its results before retrying an action.`
						)
					)
				),
			['workspace_search', 'workspace_read'].includes(name) ? 30_000 : 120_000
		)
		let settled = false
		function finish(deliver: () => void) {
			if (settled) return
			settled = true
			clearTimeout(timeout)
			signal?.removeEventListener('abort', abort)
			deliver()
		}
		function abort() {
			finish(() =>
				reject(
					Error(
						'Stopped waiting. An already-started action may still complete; check its results before retrying.'
					)
				)
			)
		}
		Promise.resolve(work).then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		)
		if (signal?.aborted) abort()
		else signal?.addEventListener('abort', abort, { once: true })
	})
}
