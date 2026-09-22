import { readInputAdmission } from '@avenos/chat-engine/input-admission'
import { historicalToolResult } from '@avenos/chat-engine/restored-history'
import { type ToolCall, toolDetail } from '@avenos/chat-engine/tool-call'
import type { Turn } from './chat'
import { modelMetricsFromPayload } from './model-metrics'
import { readFeedbackCheck } from './response-feedback'
import { anonymousSpeakerPayload } from './speaker'
import { readToolPreview, toolPreview } from './tool-preview'

/** Bounded transcript diagnostics, not execution receipts or replay instructions. */
export function turnPayload(turn: Turn): Record<string, unknown> {
	const payload: Record<string, unknown> = anonymousSpeakerPayload(turn.anonymousSpeaker)
	const inputs =
		turn.role === 'assistant' && responseInputsFromPayload({ inReplyTo: turn.inReplyTo })
	if (inputs) payload.inReplyTo = inputs
	if (turn.role === 'user' && turn.feedbackCheck)
		payload.feedbackCheck = readFeedbackCheck(turn.feedbackCheck)
	if (turn.role === 'user' && turn.inputAdmission)
		payload.inputAdmission = readInputAdmission(turn.inputAdmission)
	if (Number.isFinite(turn.durationMs) && turn.durationMs! >= 0)
		payload.responseDurationMs = turn.durationMs
	if (turn.role === 'assistant' && turn.modelRequests?.length) {
		payload.modelRequests = modelMetricsFromPayload({ modelRequests: turn.modelRequests })
		if (Number.isSafeInteger(turn.modelRequestCount) && turn.modelRequestCount! >= 0)
			payload.modelRequestCount = turn.modelRequestCount
	}
	if (!turn.calls?.length) return payload
	const calls: ToolCall[] = []
	const retained: ToolCall[] = []
	let bytes = 0
	const sizeOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
	const omitted = '… Saved detail truncated'
	// Preserve the sequence and terminal states before spending space on details.
	for (const call of turn.calls.slice(-128).reverse()) {
		const saved: ToolCall = {
			id: call.id.slice(0, 160),
			name: call.name.slice(0, 160),
			status: call.status,
			arguments: omitted,
			result: omitted,
			...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
			...(call.durationBasis ? { durationBasis: call.durationBasis } : {}),
			...(call.startedAt !== undefined ? { startedAt: call.startedAt } : {})
		}
		const size = sizeOf(saved)
		if (bytes + size > 48_000) break
		bytes += size
		calls.push(saved)
		retained.push(call)
	}
	calls.reverse()
	retained.reverse()
	const trim = (value: string) => {
		const safe = toolDetail(value)
		return safe.length > 1500 ? `${safe.slice(0, 1500)}\n${omitted}` : safe
	}
	const enrich = (index: number, patch: Partial<ToolCall>) => {
		const next = { ...calls[index]!, ...patch }
		const extra = sizeOf(next) - sizeOf(calls[index])
		if (bytes + extra > 48_000) return
		bytes += extra
		calls[index] = next
	}
	// Newest outcomes matter most. Cards survive independently of large trace bodies.
	for (let i = calls.length - 1; i >= 0; i--) {
		const preview = toolPreview(retained[i]!)
		if (preview && sizeOf(preview) <= 8000) {
			const safe = readToolPreview(JSON.parse(toolDetail(JSON.stringify(preview))))
			if (safe) enrich(i, { preview: safe })
		}
	}
	for (let i = calls.length - 1; i >= 0; i--) {
		const call = retained[i]!
		if (call.error) enrich(i, { error: trim(call.error) })
		enrich(i, { arguments: trim(call.arguments) })
		enrich(i, { result: historicalToolResult(call) })
	}
	payload.toolCalls = calls
	payload.toolCallCount = turn.calls.length
	payload.toolCallsTruncated = calls.length !== turn.calls.length
	return payload
}

export function responseInputsFromPayload(payload: Record<string, unknown>): string[] | undefined {
	const value = payload.inReplyTo
	if (
		!Array.isArray(value) ||
		!value.length ||
		value.length > 16 ||
		value.some((id) => typeof id !== 'string' || !id || id.length > 160) ||
		new Set(value).size !== value.length
	)
		return
	return [...value]
}

export function responseDurationFromPayload(payload: Record<string, unknown>): number | undefined {
	const ms = payload.responseDurationMs
	return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : undefined
}

export function callsFromPayload(payload: Record<string, unknown>): ToolCall[] {
	if (!Array.isArray(payload.toolCalls)) return []
	return payload.toolCalls
		.slice(0, 128)
		.filter(
			(call): call is ToolCall =>
				call &&
				typeof call === 'object' &&
				['id', 'name', 'arguments', 'result'].every((key) => typeof call[key] === 'string') &&
				['completed', 'failed', 'interrupted'].includes(call.status) &&
				(call.error === undefined || typeof call.error === 'string') &&
				(call.durationMs === undefined ||
					(Number.isFinite(call.durationMs) && call.durationMs >= 0))
		)
}
