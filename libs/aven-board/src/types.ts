/** Canonical board states — the folder a work item lives in is the source of truth. */
export const BOARD_COLUMN_IDS = ['inbox', 'plan', 'test', 'done'] as const

export type BoardColumnId = (typeof BOARD_COLUMN_IDS)[number]

export function isBoardColumnId(value: string): value is BoardColumnId {
	return (BOARD_COLUMN_IDS as readonly string[]).includes(value)
}

/** A single markdown-backed work item parsed from `board/<column>/<id>.md`. */
export type WorkItem = {
	/** Slug derived from the filename without extension, e.g. `0001-welcome`. */
	id: string
	/** Which column (folder) the item currently lives in. */
	column: BoardColumnId
	/** Card title — frontmatter `title`, else first H1, else humanized slug. */
	title: string
	/** Card summary — frontmatter `summary`, else first body paragraph. */
	summary: string
	/** Numeric filename prefix used for stable ordering inside a column. */
	order: number
	/** Optional labels from frontmatter `tags`. */
	tags: string[]
	/** ISO date string from frontmatter `created`, if present. */
	created?: string
	/** ISO date string from frontmatter `updated`, if present. */
	updated?: string
	/** Free-form owner/assignee from frontmatter `owner`, if present. */
	owner?: string
	/** Markdown body with frontmatter stripped. */
	body: string
	/** Original file contents including frontmatter. */
	raw: string
}

/** A rendered column: metadata plus the work items currently inside it. */
export type BoardColumn = {
	id: BoardColumnId
	/** Human label, e.g. "Inbox". */
	label: string
	/** Alternate name, e.g. "Backlog". */
	aka: string
	/** One-line description of what this column means. */
	description: string
	items: WorkItem[]
}
