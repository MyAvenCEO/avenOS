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
	idea: {
		id: 'idea',
		label: 'Idea',
		aka: 'Backlog',
		description: 'Raw ideas and tasks. Throw anything here — unrefined and unsorted.'
	},
	discovery: {
		id: 'discovery',
		label: 'Discovery',
		aka: 'Spec',
		description:
			'Interviewing to uncover the real goal and make it measurable — turning a task into a metric.'
	},
	goal: {
		id: 'goal',
		label: 'Goal',
		aka: 'Execute',
		description:
			'Carries a measurable goal. Being executed toward that single completion condition.'
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
		aka: 'Shipped',
		description: 'Verified and complete. Kept as the shipped/archived record.'
	}
}

export const ORDERED_COLUMN_IDS: readonly BoardColumnId[] = BOARD_COLUMN_IDS
