import type { ChatMessage } from './redpill'

export const RECENT_WIRE_LIMIT = 24
const RECENT_CONTENT_LIMIT = 1600

/** Keep a valid recent suffix of completed turns and the whole active tool round. */
export function recentWireMessages(
	wire: ChatMessage[],
	currentStart: number,
	limit = RECENT_WIRE_LIMIT
): { messages: ChatMessage[]; omitted: number } {
	const boundary = Math.max(0, Math.min(wire.length, currentStart))
	const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RECENT_WIRE_LIMIT
	let start = Math.max(0, boundary - size)
	// Inspect only the bounded suffix, never copy or scan the historical prefix.
	if (start > 0) while (start < boundary && wire[start].role !== 'user') start++
	const recent = wire.slice(start, boundary).map((message) => ({
		...message,
		content:
			message.content.length > RECENT_CONTENT_LIMIT
				? `${message.content.slice(0, RECENT_CONTENT_LIMIT - 1)}…`
				: message.content
	}))
	return { messages: [...recent, ...wire.slice(boundary)], omitted: start }
}

export interface HistoryEntry {
	role: 'user' | 'assistant'
	content: string
}

const words = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

function keywordScore(content: string, terms: string[]): number {
	const contentWords = words(content)
	return terms.filter((term) =>
		contentWords.some(
			(word) => word === term || (term.length >= 6 && word.startsWith(term.slice(0, 5)))
		)
	).length
}

/** Prefer exact phrases; fall back to ranked keywords when the wording differs. */
export function pageMessages<T extends HistoryEntry>(
	messages: T[],
	query: string,
	offset: number,
	limit: number
): {
	rows: HistoryEntry[]
	total: number
	offset: number
	hasMore: boolean
	matchMode: 'browse' | 'phrase' | 'keywords'
} {
	const needle = query.trim().toLocaleLowerCase()
	const nonempty = messages.filter((message) => message.content.trim())
	const phrases = needle
		? nonempty.filter((message) => message.content.toLocaleLowerCase().includes(needle))
		: []
	const terms = [...new Set(words(query).filter((word) => word.length >= 3))]
	const ranked =
		needle && phrases.length === 0
			? nonempty
					.map((message, index) => ({
						message,
						index,
						score: keywordScore(message.content, terms)
					}))
					.filter((entry) => entry.score > 0)
					.sort((a, b) => b.score - a.score || b.index - a.index)
					.map((entry) => entry.message)
			: []
	const matchMode = !needle ? 'browse' : phrases.length ? 'phrase' : 'keywords'
	const matches = !needle ? nonempty.reverse() : phrases.length ? phrases.reverse() : ranked
	const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
	const size = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 10
	return {
		rows: matches.slice(start, start + size).map((message) => {
			const lower = message.content.toLocaleLowerCase()
			const phraseAt = needle ? lower.indexOf(needle) : 0
			const termAt =
				terms
					.map((term) => lower.indexOf(term.length >= 6 ? term.slice(0, 5) : term))
					.find((index) => index >= 0) ?? 0
			const at = phraseAt >= 0 ? phraseAt : termAt
			const excerptStart = Math.max(0, at - 100)
			return {
				role: message.role,
				content: message.content.slice(excerptStart, excerptStart + 500)
			}
		}),
		total: matches.length,
		offset: start,
		hasMore: start + size < matches.length,
		matchMode
	}
}
