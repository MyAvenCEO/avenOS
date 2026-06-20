/**
 * Tiny dependency-free logger. Replaces the former `@MaiaOS/logs` import so the
 * archived lib stands alone. Same surface the SMTP code relied on: `log`, `warn`,
 * `error` — each takes a message and an optional structured-fields object.
 *
 * @param {string} scope short label prefixed to every line (e.g. "mail:inbound-smtp")
 * @returns {{
 *   log: (msg: string, fields?: Record<string, unknown>) => void
 *   warn: (msg: string, fields?: Record<string, unknown>) => void
 *   error: (msg: string, fields?: Record<string, unknown>) => void
 * }}
 */
export function createLogger(scope) {
	/**
	 * @param {(...args: unknown[]) => void} sink
	 * @param {string} level
	 */
	const emit = (sink, level) => (msg, fields) => {
		const head = `[${new Date().toISOString()}] ${level} ${scope}: ${msg}`
		if (fields && Object.keys(fields).length > 0) sink(head, fields)
		else sink(head)
	}
	return {
		log: emit(console.log, 'INFO'),
		warn: emit(console.warn, 'WARN'),
		error: emit(console.error, 'ERROR')
	}
}
