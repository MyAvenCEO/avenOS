import { parseRfc822ForView } from './rfc822.js'

/**
 * @param {import('./store-memory.js').InMemoryMailStore} store
 * @returns {Array<{
 *   id: string
 *   subject: string
 *   from: string
 *   receivedAt: number
 *   attachments: string[]
 * }>}
 */
export function listMessageSummaries(store) {
	return [...store._rows]
		.sort((a, b) => b.receivedAt - a.receivedAt)
		.map((row) => {
			const { attachments } = parseRfc822ForView(row.raw)
			return {
				id: row.id,
				subject: row.subject,
				from: row.from,
				receivedAt: row.receivedAt,
				attachments: attachments.map((a) => a.filename)
			}
		})
}
