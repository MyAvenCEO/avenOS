import { BOARD_COLUMN_IDS, type BoardColumnId } from './types'

export type BoardColumnMeta = {
	id: BoardColumnId
	label: string
	aka: string
	description: string
}

/**
 * Canonical column definitions, in board order.
 * The folder under `board/` matching `id` is the single source of truth for state.
 */
export const BOARD_COLUMN_META: Record<BoardColumnId, BoardColumnMeta> = {
	ideate: {
		id: 'ideate',
		label: 'Ideate',
		aka: 'Backlog',
		description: 'Raw ideas and tasks. Throw anything here — unrefined and unsorted.'
	},
	discover: {
		id: 'discover',
		label: 'Discover',
		aka: 'Spec',
		description:
			'Interviewing to uncover the real goal and make it measurable — turning a task into a metric.'
	},
	build: {
		id: 'build',
		label: 'Build',
		aka: 'Execute',
		description:
			'Carries a measurable goal. Being built toward that single completion condition.'
	},
	review: {
		id: 'review',
		label: 'Review',
		aka: 'Evaluate',
		description:
			'Built and measured against the goal — awaiting human verification (HITL) before it ships.'
	},
	ship: {
		id: 'ship',
		label: 'Ship',
		aka: 'Released',
		description:
			'Released to all targets (server node + Mac/iOS apps) and pushed to main — the shipped, archived record.'
	}
}

export const ORDERED_COLUMN_IDS: readonly BoardColumnId[] = BOARD_COLUMN_IDS
