/** Sidebar / spawn keys — used only for hardcoded test spawning (no DB seed). */
export const WORKER_CATEGORY_KEYS = ['calendar', 'finance', 'health', 'projects'] as const

export type WorkerCategoryKey = (typeof WORKER_CATEGORY_KEYS)[number]

export const WORKER_CATEGORY_LABELS: Record<WorkerCategoryKey, string> = {
	calendar: 'Calendar',
	finance: 'Finance',
	health: 'Health',
	projects: 'Projects'
}

export function randomWorkerCategoryKey(): WorkerCategoryKey {
	const i = Math.floor(Math.random() * WORKER_CATEGORY_KEYS.length)
	const key = WORKER_CATEGORY_KEYS[i]
	if (key === undefined) return WORKER_CATEGORY_KEYS[0]
	return key
}
