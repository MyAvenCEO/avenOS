export interface ResponseFeedback {
	id: string
	sequence: number
	vote: 'up' | 'down' | null
	reason: string
	updatedAt: string
	/** Absent for a manual vote (including a manual clear). */
	inferredFrom?: string
}

/** An assessment of an eligible saved response after the input has been admitted. */
export interface ResponseReaction {
	intentId: string
	responseId: string
	vote: 'up' | 'down'
	commandId: string
}

export { type FeedbackCheck, readFeedbackCheck } from '@avenos/intents/feedback'

import type { FeedbackCheck } from '@avenos/intents/feedback'
import type { Turn } from './chat'

/** Freeze what the user was reacting to, including the active response identity.
 * Do not substitute a later answer when asynchronous routing/feedback finishes. */
export function captureFeedbackContext(turns: readonly Turn[]): FeedbackCheck['recent'] {
	return turns
		.filter((t) => !t.attachment && !t.deliveryError)
		.slice(-6)
		.map((t) => ({
			role: t.role,
			content: t.content.slice(0, 1200),
			...(t.role === 'assistant' && t.persisted
				? { responseId: t.id }
				: t.role === 'assistant' && t.inReplyTo?.length
					? { responseId: t.id, pending: true as const, requestId: t.inReplyTo[0] }
					: {})
		}))
}

/** Delayed history reads must not undo an acknowledged vote, including a clear. */
export function latestFeedback(
	current: ResponseFeedback | null | undefined,
	incoming: ResponseFeedback | null | undefined
): ResponseFeedback | null {
	if (!incoming || (current && current.sequence > incoming.sequence)) return current ?? null
	return incoming
}

export interface FeedbackCommand {
	id: string
	contributorKind: 'human'
	kind: 'response-feedback'
	text: null
	payload: {
		responseId: string
		vote: ResponseFeedback['vote']
		reason: string
		previousFeedbackId: string | null
		inferredFrom?: string
		/** Exact user phrase supporting an inferred vote. */
		sourceQuote?: string
	}
}

export function automaticFeedbackCommand(
	reaction: ResponseReaction,
	inputId: string,
	previous: ResponseFeedback | null | undefined,
	editor?: FeedbackEditor,
	sourceQuote?: string
): FeedbackCommand | null {
	// A manual clear is a decision too. Never revive it, or overwrite an unfinished edit.
	if (
		(previous && !previous.inferredFrom) ||
		editor?.saving ||
		editor?.pending ||
		editor?.draft != null
	)
		return null
	return {
		id: reaction.commandId,
		contributorKind: 'human',
		kind: 'response-feedback',
		text: null,
		payload: {
			responseId: reaction.responseId,
			vote: reaction.vote,
			reason: '',
			previousFeedbackId: previous?.id ?? null,
			inferredFrom: inputId,
			...(sourceQuote !== undefined && { sourceQuote })
		}
	}
}

/** Unsaved UI state follows the response between native history and popup. */
export interface FeedbackEditor {
	draft: string | null
	pending: FeedbackCommand | null
	saving: boolean
	error: string | null
}

export function feedbackCommand(
	responseId: string,
	previous: ResponseFeedback | null | undefined,
	vote: ResponseFeedback['vote'],
	reason: string
): FeedbackCommand {
	if (reason.length > 2000) throw Error('Keep the reason under 2,000 characters.')
	return {
		id: crypto.randomUUID(),
		contributorKind: 'human',
		kind: 'response-feedback',
		text: null,
		payload: {
			responseId,
			vote,
			reason: vote ? reason.trim() : '',
			previousFeedbackId: previous?.id ?? null
		}
	}
}
