import type { ModelPhase } from './model'

/** Content-free observations. These are not estimates of context occupancy or cost. */
export interface ModelRequestMetric {
	id: string
	phase: ModelPhase
	status: 'running' | 'completed' | 'failed' | 'interrupted' | 'incomplete'
	startedAt?: number
	durationMs?: number
	/** First content delta, which may be an unverified draft rather than visible speech. */
	firstTextMs?: number
	inputTokens?: number
	outputTokens?: number
	/** Original execution measurement restored during recovery; not a new provider request. */
	replayed?: true
}

export const MAX_MODEL_METRICS = 32
const phases: ModelPhase[] = ['answer', 'verification', 'repair', 'checklist']
const count = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const duration = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Missing/invalid usage stays unknown. Ignore arbitrary provider metadata. */
export function modelTokenUsage(usage: Record<string, unknown>) {
	return {
		...(count(usage.prompt_tokens) ? { inputTokens: usage.prompt_tokens } : {}),
		...(count(usage.completion_tokens) ? { outputTokens: usage.completion_tokens } : {})
	}
}

export function modelMetricsFromPayload(payload: Record<string, unknown>): ModelRequestMetric[] {
	if (!Array.isArray(payload.modelRequests)) return []
	return payload.modelRequests.slice(-MAX_MODEL_METRICS).flatMap((raw) => {
		if (
			!raw ||
			typeof raw !== 'object' ||
			typeof raw.id !== 'string' ||
			!raw.id ||
			raw.id.length > 160 ||
			!phases.includes(raw.phase) ||
			!['completed', 'failed', 'interrupted', 'incomplete'].includes(raw.status) ||
			!duration(raw.durationMs)
		)
			return []
		return [
			{
				id: raw.id,
				phase: raw.phase,
				status: raw.status,
				durationMs: raw.durationMs,
				...(count(raw.startedAt) ? { startedAt: raw.startedAt } : {}),
				...(raw.replayed === true ? { replayed: true as const } : {}),
				...(duration(raw.firstTextMs) && raw.firstTextMs <= raw.durationMs
					? { firstTextMs: raw.firstTextMs }
					: {}),
				...modelTokenUsage({
					prompt_tokens: raw.inputTokens,
					completion_tokens: raw.outputTokens
				})
			}
		]
	})
}

export function modelRequestCountFromPayload(payload: Record<string, unknown>): number | undefined {
	return count(payload.modelRequestCount) ? payload.modelRequestCount : undefined
}
