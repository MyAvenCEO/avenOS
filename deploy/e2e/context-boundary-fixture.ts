/** Synthetic long conversations and actual provider-token sizing, shared by direct and native qualification. */
import assert from 'node:assert/strict'
export const template = { enable_thinking: false }
export type Message = { role: 'user' | 'assistant' | 'system'; content: string }
// Unrelated invented inventory notes are spread over actual alternating messages,
// not one enormous prompt. Assertions cover an early fact and later corrections.
export function conversation(rows: number): Message[] {
	const messages: Message[] = [
		{
			role: 'system',
			content:
				'Read this fictional conversation. Answer the final question from its facts, respecting explicit corrections. Do not execute actions. Return only the requested JSON object.'
		}
	]
	for (let turn = 0; turn < 56; turn++) {
		let content =
			turn === 0
				? 'Our fictional museum code is MOSS-ORBIT. The rehearsal room is North Loft. The opening day is Thursday. The invitation is only a draft, not sent.\n'
				: turn === 28
					? 'Correction: use East Atrium instead of North Loft.\n'
					: turn === 55
						? 'Letzte Korrektur: Der Eröffnungstag ist Dienstag statt Donnerstag. Die Einladung wurde noch NICHT verschickt.\n'
						: ''
		const count = Math.floor(rows / 56) + (turn < rows % 56 ? 1 : 0)
		for (let row = 0; row < count; row++)
			content += `Invented cabinet ${turn * 10000 + row}: paper moth, wooden comet, ceramic fern; inspection pending, no dispatch.\n`
		messages.push(
			{ role: 'user', content },
			{
				role: 'assistant',
				content: `Noted imaginary inventory segment ${turn + 1}; this is not proof of a completed action.`
			}
		)
	}
	messages.push({
		role: 'user',
		content:
			'From our conversation, return JSON with museumCode (exact code), room (current room), weekday (current opening day in English), invitationSent (boolean). No explanation.'
	})
	return messages
}

export function contextBoundary(base: string, model: string, capacity: number) {
	async function tokenCount(messages: Message[]): Promise<number> {
		const response = await fetch(base + '/tokenize', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model, messages, chat_template_kwargs: template }),
			signal: AbortSignal.timeout(60_000)
		})
		assert(response.ok, `Actual provider tokenizer unavailable: ${response.status}`)
		const result = await response.json()
		assert(Number.isSafeInteger(result.count) && result.max_model_len === capacity)
		return result.count
	}
	return async function atBoundary(target: number) {
		let low = 0,
			high = Math.ceil(target / 10)
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2)
			if ((await tokenCount(conversation(middle))) <= target) low = middle
			else high = middle
		}
		const messages = conversation(low),
			tokens = await tokenCount(messages)
		assert(
			target - tokens < 80 && tokens <= target,
			'Must actually reach the requested token boundary'
		)
		return { messages, tokens, rows: low }
	}
}
