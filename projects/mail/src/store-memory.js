/**
 * @typedef {{
 *   id: string
 *   subject: string
 *   from: string
 *   receivedAt: number
 *   raw: Uint8Array
 * }} MailRow
 * @typedef {{ _rows: MailRow[] }} InMemoryMailStore
 */

/**
 * @returns {InMemoryMailStore}
 */
export function createInMemoryMailStore() {
	return { _rows: [] }
}
