import { createHash } from 'node:crypto'

export interface RetrievalInput {
	query?: string
	cursor?: string
	limit?: number
	intent?: string
	state?: 'all' | 'active' | 'archive'
}
export class InvalidRetrievalCursor extends Error {}
interface Cursor {
	binding: string
	id: string
	updated?: string
	sequence?: number
}
export function retrievalPage(subject: string, input: RetrievalInput, kind: string) {
	const query = (input.query ?? '').trim()
	const binding = createHash('sha256')
		.update(JSON.stringify([subject, kind, query, input.intent ?? '', input.state ?? 'all']))
		.digest('hex')
	let after: Cursor | undefined
	if (input.cursor) {
		try {
			if (input.cursor.length > 2048) throw Error()
			after = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as Cursor
			if (
				after.binding !== binding ||
				!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(after.id)
			)
				throw Error()
			if (
				after.updated !== undefined &&
				(typeof after.updated !== 'string' ||
					after.updated.length > 50 ||
					!Number.isFinite(Date.parse(after.updated)))
			)
				throw Error()
			if (
				after.sequence !== undefined &&
				(!Number.isSafeInteger(after.sequence) || after.sequence < 1)
			)
				throw Error()
		} catch {
			throw new InvalidRetrievalCursor('Cursor does not match this search. Restart the query.')
		}
	}
	const size = Math.max(
		1,
		Math.min(
			50,
			Math.floor(typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : 20)
		)
	)
	return {
		query,
		size,
		after,
		cursor: (row: Omit<Cursor, 'binding'>) =>
			Buffer.from(JSON.stringify({ binding, ...row })).toString('base64url')
	}
}
