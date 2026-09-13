/** Wait without leaking abort listeners; callers must also cancel underlying work. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted()
	let abort: () => void = () => {}
	const cancelled = new Promise<never>((_, reject) => {
		abort = () => reject(signal.reason)
		signal.addEventListener('abort', abort, { once: true })
	})
	try {
		return await Promise.race([work, cancelled])
	} finally {
		signal.removeEventListener('abort', abort)
	}
}
