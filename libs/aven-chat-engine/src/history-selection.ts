import type { ChatMessage } from './model'
import { historicalToolResult, withoutHistoricalResearch } from './restored-history'
import { toolArgumentsError } from './tool-call'

export const RECENT_WIRE_LIMIT = 24
const RECENT_CONTENT_LIMIT = 1600

/** Keep a valid recent suffix of completed turns and the whole active tool round. */
export function recentWireMessages(
	wire: ChatMessage[],
	currentStart: number,
	limit = RECENT_WIRE_LIMIT
): { messages: ChatMessage[]; omitted: number; priorMessages: number } {
	const boundary = Math.max(0, Math.min(wire.length, currentStart))
	const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RECENT_WIRE_LIMIT
	let start = Math.max(0, boundary - size)
	// Inspect only the bounded suffix, never copy or scan the historical prefix.
	if (start > 0) while (start < boundary && wire[start].role !== 'user') start++
	const recent = withoutHistoricalResearch(wire.slice(start, boundary)).map((message) => ({
		...message,
		content:
			message.role === 'tool'
				? message.content.length <= RECENT_CONTENT_LIMIT
					? message.content
					: historicalToolResult({ status: 'completed', result: message.content })
				: message.content.length > RECENT_CONTENT_LIMIT
					? `${message.content.slice(0, RECENT_CONTENT_LIMIT - 1)}…`
					: message.content
	}))
	// Provider chat templates parse historical arguments too. Preserve malformed
	// attempts as quoted data, never as executable calls with invented arguments.
	const messages = [...recent, ...wire.slice(boundary)].map((message) =>
		message.tool_calls
			? {
					...message,
					tool_calls: message.tool_calls.map((call) =>
						toolArgumentsError(call.function.arguments)
							? {
									...call,
									function: {
										...call.function,
										arguments: JSON.stringify({
											invalidArguments: call.function.arguments,
											notice: 'Malformed call; not executed.'
										})
									}
								}
							: call
					)
				}
			: message
	)
	return {
		messages,
		omitted: start,
		priorMessages: recent.filter(
			(message) => ['user', 'assistant'].includes(message.role) && message.content.trim()
		).length
	}
}

export interface HistoryEntry {
	id?: string
	offset?: number
	complete?: boolean
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
	limit: number,
	selection: { role?: 'user' | 'assistant'; order?: 'oldest' | 'newest' } = {}
): {
	rows: HistoryEntry[]
	total: number
	offset: number
	hasMore: boolean
	matchMode: 'browse' | 'phrase' | 'keywords'
} {
	const needle = query.trim().toLocaleLowerCase()
	const nonempty = messages.filter(
		(message) => message.content.trim() && (!selection.role || message.role === selection.role)
	)
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
	if (selection.order) {
		const positions = new Map(messages.map((message, index) => [message, index]))
		const direction = selection.order === 'oldest' ? 1 : -1
		matches.sort((a, b) => direction * (positions.get(a)! - positions.get(b)!))
	}
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
				...(message.id && {
					id: message.id,
					sourceId: message.id,
					offset: excerptStart,
					complete: excerptStart === 0 && message.content.length <= 500
				}),
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
