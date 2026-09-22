import { readInputAdmission } from '@avenos/chat-engine/input-admission'
import {
	modelMetricsFromPayload,
	modelRequestCountFromPayload
} from '@avenos/chat-engine/model-metrics'
import { readFeedbackCheck } from '@avenos/chat-engine/response-feedback'
import { anonymousSpeakerFromPayload } from '@avenos/chat-engine/speaker'
import {
	callsFromPayload,
	responseDurationFromPayload,
	responseInputsFromPayload
} from '@avenos/chat-engine/turn-payload'
import type { PersistentIntentDetail } from './intents.svelte'

/** One history projection for selection, admission and background refresh. */
export function persistentTurns(detail: PersistentIntentDetail) {
	return detail.contributions.flatMap((entry) => {
		if (
			entry.kind === 'response-feedback' ||
			!entry.text ||
			(entry.contributorKind !== 'human' && entry.contributorKind !== 'agent')
		)
			return []
		const anonymousSpeaker =
			entry.contributorKind === 'human' ? anonymousSpeakerFromPayload(entry.payload) : null
		return [
			{
				id: entry.id,
				role: entry.contributorKind === 'human' ? ('user' as const) : ('assistant' as const),
				content: entry.text,
				inputAdmission:
					entry.contributorKind === 'human'
						? readInputAdmission(entry.payload.inputAdmission)
						: undefined,
				persisted: true,
				inReplyTo:
					entry.contributorKind === 'agent' ? responseInputsFromPayload(entry.payload) : undefined,
				feedback: entry.feedback ?? null,
				feedbackCheck:
					entry.contributorKind === 'human' && !entry.feedbackCheckComplete
						? readFeedbackCheck(entry.payload.feedbackCheck)
						: undefined,
				calls: callsFromPayload(entry.payload),
				durationMs: responseDurationFromPayload(entry.payload),
				modelRequests:
					entry.contributorKind === 'agent' ? modelMetricsFromPayload(entry.payload) : [],
				modelRequestCount:
					entry.contributorKind === 'agent'
						? modelRequestCountFromPayload(entry.payload)
						: undefined,
				...(anonymousSpeaker ? { anonymousSpeaker } : {})
			}
		]
	})
}
