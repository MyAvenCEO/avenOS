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
	plan: {
		id: 'plan',
		label: 'Plan',
		aka: 'Spec',
		description:
			'Specced and ready for an agent to build. Has a concrete plan + acceptance criteria.'
	},
	test: {
		id: 'test',
		label: 'Test',
		aka: 'Review',
		description: 'Implemented and awaiting verification — tests, review, and acceptance checks.'
	},
	done: {
		id: 'done',
		label: 'Done',
		aka: 'Shipped',
		description: 'Verified and complete. Kept as a record of what shipped.'
	}
}

export const ORDERED_COLUMN_IDS: readonly BoardColumnId[] = BOARD_COLUMN_IDS
