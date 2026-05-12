import type { ActorTier } from './boring-avatar'
import type { ActorContextTab } from './types'

/** Declarative tab sets per tier — later this can load from JSON/config. */
export const ACTOR_CONTEXT_TAB_DEFS: Record<
	ActorTier,
	{ id: ActorContextTab; label: string }[]
> = {
	orchestrator: [
		{ id: 'overview', label: 'Overview' },
		{ id: 'config', label: 'Config' },
		{ id: 'context', label: 'Context' }
	],
	supervisor: [
		{ id: 'overview', label: 'Overview' },
		{ id: 'config', label: 'Config' },
		{ id: 'context', label: 'Context' }
	],
	worker: [
		{ id: 'overview', label: 'Overview' },
		{ id: 'config', label: 'Config' }
	]
}

export function contextTabsForTier(tier: ActorTier): { id: ActorContextTab; label: string }[] {
	return ACTOR_CONTEXT_TAB_DEFS[tier]
}

export function isTabAllowedForTier(tab: ActorContextTab, tier: ActorTier): boolean {
	return ACTOR_CONTEXT_TAB_DEFS[tier].some((t) => t.id === tab)
}

export function firstTabForTier(tier: ActorTier): ActorContextTab {
	return ACTOR_CONTEXT_TAB_DEFS[tier][0]?.id ?? 'overview'
}
