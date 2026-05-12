import type { DispatcherState } from './types'

export const initialDispatcherState: DispatcherState = {
	activeIntents: {}
}

export function normalizeDispatcherState(state: unknown): DispatcherState {
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return {
			...initialDispatcherState,
			activeIntents: {}
		}
	}

	const candidate = state as Partial<DispatcherState>
	return {
		activeIntents: candidate.activeIntents ?? {}
	}
}