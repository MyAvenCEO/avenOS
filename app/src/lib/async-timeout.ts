/**
 * Safety-net for IPC that should be fast (local SurrealKV / avenDB) but might wedge on contention.
 */
export function withTimeoutMs<T>(p: Promise<T>, ms: number, label = 'Timed out'): Promise<T> {
	if (typeof window === 'undefined') return p
	return new Promise<T>((resolve, reject) => {
		const id = window.setTimeout(() => reject(new Error(`${label} (${ms} ms)`)), ms)
		p.then(
			(v) => {
				window.clearTimeout(id)
				resolve(v)
			},
			(e) => {
				window.clearTimeout(id)
				reject(e)
			},
		)
	})
}
