import {
	automaticFeedbackCommand,
	type FeedbackCommand,
	feedbackCommand,
	latestFeedback,
	type ResponseFeedback
} from '@avenos/chat-engine/response-feedback'
import { transportError } from '@avenos/chat-engine/transport-error'
import { invoke } from '@tauri-apps/api/core'
import { customerWork } from '$lib/artifacts/customer-work.svelte'
import { intents } from '$lib/intents/intents.svelte'
import type { Turn } from './chat.svelte'
import type { FeedbackRecoveryHost } from './feedback-recovery'

export function feedbackEditor(turn: Turn) {
	turn.feedbackEditor ??= { draft: null, pending: null, saving: false, error: null }
	return turn.feedbackEditor
}

/** One persistence path for clicks, inline reasons and model-inferred annotations. */
export async function saveFeedback(
	turn: Turn,
	intentId: string,
	next: ResponseFeedback['vote'],
	reason = turn.feedback?.reason ?? '',
	automatic?: FeedbackCommand
) {
	if (!turn.persisted || feedbackEditor(turn).saving) return
	const edit = feedbackEditor(turn)
	if (
		automatic &&
		(edit.pending || edit.draft != null || (turn.feedback && !turn.feedback.inferredFrom))
	)
		return
	edit.pending ??= automatic ?? feedbackCommand(turn.id, turn.feedback, next, reason)
	const command = edit.pending
	const revision = intents.environmentRevision
	edit.saving = true
	edit.error = null
	customerWork.feedback++
	try {
		const result = await invoke<{ id: string; sequence: number; createdAt: string }>(
			'intent_append_contribution',
			{
				intentId,
				contribution: command
			}
		)
		if (revision !== intents.environmentRevision) return
		turn.feedback = latestFeedback(turn.feedback, {
			id: result.id,
			sequence: result.sequence,
			vote: command.payload.vote,
			reason: command.payload.reason,
			updatedAt: result.createdAt,
			...(command.payload.inferredFrom ? { inferredFrom: command.payload.inferredFrom } : {})
		})
		edit.pending = null
		edit.draft = null
	} catch (error) {
		if (revision !== intents.environmentRevision) return
		// Another tab's manual edit is authoritative. Do not keep retrying an inference.
		if (command.payload.inferredFrom && transportError(error).status === 409) {
			await reloadFeedback(turn)
		} else edit.error = transportError(error).message
	} finally {
		edit.saving = false
		customerWork.feedback--
	}
}

export async function reloadFeedback(turn: Turn) {
	const edit = feedbackEditor(turn)
	const revision = intents.environmentRevision
	try {
		const result = await invoke<{ feedback: ResponseFeedback | null }>('intent_message_get', {
			messageId: turn.id
		})
		if (revision !== intents.environmentRevision) return
		turn.feedback = latestFeedback(turn.feedback, result.feedback)
		edit.pending = null
		edit.error = null
	} catch (error) {
		if (revision === intents.environmentRevision) edit.error = transportError(error).message
	}
}

/** The saved input fixes both the source and possible response targets. Recovery
 * cannot route a message or run agent tools, and cannot overwrite a manual vote. */
export async function saveFeedbackAssessment(
	args: Parameters<FeedbackRecoveryHost['commit']>,
	localResponse?: Turn
) {
	const [intentId, input, check, feedback] = args
	const revision = intents.environmentRevision
	const current = () => {
		if (revision !== intents.environmentRevision) throw Error('The workspace changed.')
	}
	const source = await invoke<{ feedbackCheckComplete: boolean }>('intent_message_get', {
		messageId: input.id
	})
	current()
	if (source.feedbackCheckComplete) {
		// A prior write may have lost its acknowledgement; also repair the visible
		// controls, without creating a new annotation or repeating classification.
		if (localResponse) {
			await reloadFeedback(localResponse)
			if (localResponse.feedbackEditor?.error) throw Error(localResponse.feedbackEditor.error)
		}
		return
	}
	if (feedback) {
		let saved: { feedback: ResponseFeedback | null }
		try {
			saved = await invoke('intent_message_get', { messageId: feedback.responseId })
		} catch (error) {
			current()
			if (
				transportError(error).status === 404 &&
				check.recent.some((e) => e.responseId === feedback.responseId && e.pending)
			)
				return 'deferred' as const
			throw error
		}
		current()
		const response =
			localResponse ??
			({ id: feedback.responseId, role: 'assistant', content: '', persisted: true } as Turn)
		response.feedback = latestFeedback(response.feedback, saved.feedback)
		if (response.feedback?.id === check.commandId) return
		const command = automaticFeedbackCommand(
			{ ...feedback, intentId: check.intentId, commandId: check.commandId },
			input.id,
			response.feedback,
			response.feedbackEditor,
			feedback.quote
		)
		if (command) {
			await saveFeedback(response, check.intentId, feedback.vote, '', command)
			current()
			if (response.feedbackEditor?.error) throw Error(response.feedbackEditor.error)
			if (response.feedback?.id === check.commandId) return
		}
	}
	// A neutral judgement or a newer/manual choice completes this check without
	// emitting a null vote (which would otherwise clear the user's annotation).
	current()
	customerWork.feedback++
	try {
		await invoke('intent_append_contribution', {
			intentId,
			contribution: {
				id: check.commandId,
				contributorKind: 'human',
				kind: 'feedback-assessment',
				text: null,
				payload: { sourceId: input.id }
			}
		})
	} finally {
		customerWork.feedback--
	}
}
