import { SkillValidationError } from './errors'
import type { SkillCallAction, SkillWorkerResult } from './types'

export interface NormalizedWorkerResult {
	state: unknown
	events?: SkillWorkerResult['events']
	completed: boolean
	result?: unknown
	actions?: SkillCallAction[]
	contextAppends?: SkillWorkerResult['contextAppends']
}

export function normalizeWorkerResult(raw: unknown): NormalizedWorkerResult {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new SkillValidationError('Worker result must be an object')
	}

	const record = raw as Record<string, unknown>
	const actions = Array.isArray(record.actions) ? (record.actions as SkillCallAction[]) : undefined
	const hasActions = (actions?.length ?? 0) > 0
	const hasResult = Object.hasOwn(record, 'result') && record.result !== undefined
	const completedValue = record.completed
	const explicitCompleted = typeof completedValue === 'boolean' ? completedValue : undefined

	if (hasActions && hasResult) {
		throw new SkillValidationError('Worker result may not include both actions and result')
	}

	if (hasActions && explicitCompleted === true) {
		throw new SkillValidationError('Worker result actions require completed=false')
	}

	if (explicitCompleted === true && !hasResult) {
		throw new SkillValidationError('Worker result completed=true requires result')
	}

	if (explicitCompleted === false && hasResult) {
		throw new SkillValidationError('Worker result completed=false may not include result')
	}

	const completed = hasActions ? false : hasResult

	if (!completed && explicitCompleted === true) {
		throw new SkillValidationError('Worker result completed=true requires result')
	}

	return {
		state: record.state ?? {},
		events: Array.isArray(record.events) ? (record.events as SkillWorkerResult['events']) : undefined,
		completed,
		result: completed ? record.result : undefined,
		actions: hasActions ? actions : undefined,
		contextAppends: Array.isArray(record.contextAppends)
			? (record.contextAppends as SkillWorkerResult['contextAppends'])
			: undefined
	}
}