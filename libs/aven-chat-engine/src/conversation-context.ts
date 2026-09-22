import { admittedMessage, type InputAdmission } from './input-admission'

export interface ConversationMessage {
	role: 'user' | 'assistant'
	content: string
	inputAdmission?: InputAdmission
}

/** Bounded visible dialogue, not tool chatter or the author's rejected draft.
 * Keep the end of long replies: that is often the offer a short confirmation refers to.
 */
export function conversationContext(
	messages: readonly ConversationMessage[]
): ConversationMessage[] {
	const selected: ConversationMessage[] = []
	let remaining = 16000
	for (const message of messages.slice(-12).reverse()) {
		if (!message.content.trim()) continue
		const original = admittedMessage(message)
		const limit = Math.min(4000, remaining)
		if (limit < 200) break
		const marker = '\n[Earlier text shortened]\n'
		const tail = Math.floor((limit - marker.length) / 2)
		const content =
			original.length <= limit
				? original
				: `${original.slice(0, limit - marker.length - tail)}${marker}${original.slice(-tail)}`
		selected.unshift({ role: message.role, content })
		remaining -= content.length
	}
	return selected
}

export const CONTINUITY_INSTRUCTIONS =
	'Interpret the latest message together with the recent conversation. A short confirmation, correction, or "continue" refers to the preceding offer or active task, not a new document-verification request. Preserve the requested deliverable and accumulated user constraints. User-confirmed dates and preferences are user inputs; do not demand that they appear in a PDF. Previous assistant statements are context, not independent factual evidence. A proposed plan may combine sourced facts with clearly proposed activities; those activities need not be printed in the source. Drafting an itinerary or plan in chat is not authorization to create tasks, calendar entries or other stored changes unless requested.'
