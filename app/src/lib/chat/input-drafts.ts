import { readFeedbackCheck } from '@avenos/chat-engine/response-feedback'
import { readSourceContext } from '@avenos/chat-engine/source-context'
import { anonymousSpeakerFromPayload } from '@avenos/chat-engine/speaker'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { inputCaptureSchema } from './input-capture'
import type { InputInbox } from './input-inbox.svelte'
import type { PendingInput } from './input-inbox-controller'

function target(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false
	const t = value as Record<string, unknown>
	return t.kind === 'existing'
		? typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 160
		: t.kind === 'new' && typeof t.title === 'string' && !!t.title.trim() && t.title.length <= 160
}

/** Local recovery is never a source of authority; restored choices are checked again. */
export function readPending(value: unknown): PendingInput[] {
	if (!Array.isArray(value) || value.length > 100)
		throw Error('Saved pending messages could not be read.')
	const ids = new Set<string>()
	for (const item of value) {
		if (
			!item ||
			typeof item !== 'object' ||
			typeof item.id !== 'string' ||
			ids.has(item.id) ||
			typeof item.text !== 'string' ||
			typeof item.originalText !== 'string' ||
			typeof item.defaultId !== 'string' ||
			typeof item.locale !== 'string' ||
			typeof item.decisionId !== 'string' ||
			!Number.isInteger(item.revision) ||
			item.revision < 1 ||
			!Array.isArray(item.corrections) ||
			!item.corrections.every((s: unknown) => typeof s === 'string') ||
			item.text.length > 16000 ||
			item.originalText.length > 8000 ||
			item.id.length > 160 ||
			item.corrections.length > 100 ||
			item.corrections.some((s: string) => s.length > 8000) ||
			!Array.isArray(item.intents) ||
			item.intents.length > 1000 ||
			!item.intents.every(
				(i: Record<string, unknown>) =>
					i &&
					typeof i.id === 'string' &&
					typeof i.title === 'string' &&
					(i.summary === undefined || typeof i.summary === 'string') &&
					(i.updatedAt === undefined || typeof i.updatedAt === 'string')
			) ||
			!Number.isInteger(item.selectionEpoch) ||
			typeof item.createdAt !== 'string' ||
			!Number.isFinite(Date.parse(item.createdAt)) ||
			typeof item.topic !== 'string' ||
			typeof item.confirmed !== 'boolean' ||
			(item.capture !== undefined && !inputCaptureSchema.safeParse(item.capture).success) ||
			(item.responseMode !== undefined && !['clarify', 'work'].includes(item.responseMode)) ||
			(item.feedbackCheck !== undefined && !readFeedbackCheck(item.feedbackCheck)) ||
			(item.sourceContext !== undefined &&
				(!readSourceContext(item.sourceContext) ||
					item.sourceContext.intentId !== item.defaultId)) ||
			(item.suggestion !== null && !target(item.suggestion)) ||
			(item.assignment !== undefined && !target(item.assignment)) ||
			(item.speaker !== undefined &&
				!anonymousSpeakerFromPayload({ anonymousSpeaker: item.speaker })) ||
			(item.replyTo !== undefined &&
				(!item.replyTo ||
					typeof item.replyTo.id !== 'string' ||
					!Number.isInteger(item.replyTo.revision) ||
					typeof item.replyTo.decisionId !== 'string'))
		)
			throw Error('Saved pending messages could not be read.')
		ids.add(item.id)
	}
	return value as PendingInput[]
}

const restored = new WeakMap<InputInbox, number>()
export async function restoreInputDrafts(input: InputInbox, stillCurrent: () => boolean) {
	if (!isTauri()) return // Browser preview is session-only; no plaintext localStorage fallback.
	const generation = input.recoveryGeneration
	if (restored.get(input) === generation) return
	input.setPersistence(async () => {
		throw Error('Private input recovery is still loading. Try again shortly.')
	})
	const result = await invoke<{ scope: string; revision: number; items: unknown }>(
		'input_drafts_load'
	)
	if (!stillCurrent() || generation !== input.recoveryGeneration) return
	const items = readPending(result.items)
	let revision = result.revision
	input.setPersistence(async (items) => {
		revision = await invoke('input_drafts_save', {
			scopeId: result.scope,
			items,
			expectedRevision: revision
		})
	})
	input.restore(items)
	await input.persist()
	restored.set(input, generation)
}
