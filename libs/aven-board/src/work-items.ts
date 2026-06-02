import { BOARD_COLUMN_META, ORDERED_COLUMN_IDS } from './columns'
import { parseFrontmatter } from './frontmatter'
import { type BoardColumn, type BoardColumnId, isBoardColumnId, type WorkItem } from './types'

/**
 * Build-time load of every work item under `board/<column>/*.md`.
 *
 * These are eager raw imports so the board is a zero-IPC visualizer of the
 * git-tracked markdown files: in dev Vite hot-reloads on add/move/edit, and a
 * Tauri build bakes in the current board state. Moving a card between columns
 * is literally `git mv board/inbox/x.md board/plan/x.md` (see AGENTS.md).
 */
const columnModules: Record<BoardColumnId, Record<string, string>> = {
	inbox: import.meta.glob('../board/inbox/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>,
	plan: import.meta.glob('../board/plan/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>,
	test: import.meta.glob('../board/test/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>,
	done: import.meta.glob('../board/done/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>
}

function slugFromPath(path: string): string {
	const base = path.split('/').pop() ?? ''
	return base.replace(/\.md$/, '')
}

function orderFromSlug(slug: string): number {
	const n = Number.parseInt(slug.slice(0, 4), 10)
	return Number.isFinite(n) ? n : 9999
}

function humanizeSlug(slug: string): string {
	const rest = slug
		.replace(/^\d+[-_]?/, '')
		.replace(/[-_]+/g, ' ')
		.trim()
	if (rest === '') return slug
	return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function firstHeading(body: string): string | undefined {
	const m = body.match(/^\s*#\s+(.+?)\s*$/m)
	return m ? m[1].trim() : undefined
}

/** First non-empty, non-heading, non-list paragraph — used as a card summary fallback. */
function firstParagraph(body: string): string | undefined {
	const blocks = body.split(/\r?\n\r?\n/)
	for (const block of blocks) {
		const line = block.trim()
		if (line === '') continue
		if (line.startsWith('#')) continue
		if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\.\s/.test(line)) continue
		if (line.startsWith('>')) continue
		if (line.startsWith('```')) continue
		const flattened = line.replace(/\s+/g, ' ')
		return flattened.length > 200 ? `${flattened.slice(0, 197)}…` : flattened
	}
	return undefined
}

function buildWorkItem(path: string, raw: string, column: BoardColumnId): WorkItem {
	const slug = slugFromPath(path)
	const { fields, tags, body } = parseFrontmatter(raw)
	const trimmedBody = body.trim()
	const title = fields.title || firstHeading(trimmedBody) || humanizeSlug(slug)
	const summary = fields.summary || firstParagraph(trimmedBody) || ''
	return {
		id: slug,
		column,
		title,
		summary,
		order: orderFromSlug(slug),
		tags,
		created: fields.created || undefined,
		updated: fields.updated || undefined,
		owner: fields.owner || undefined,
		goal: fields.goal || undefined,
		body: trimmedBody,
		raw
	}
}

function buildColumnItems(column: BoardColumnId): WorkItem[] {
	const modules = columnModules[column]
	return Object.entries(modules)
		.map(([path, raw]) => buildWorkItem(path, raw, column))
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Every column, in board order, with its work items loaded and sorted. */
export function getBoardColumns(): BoardColumn[] {
	return ORDERED_COLUMN_IDS.map((id) => {
		const meta = BOARD_COLUMN_META[id]
		return { ...meta, items: buildColumnItems(id) }
	})
}

/** Flat list of every work item across all columns. */
export function getAllWorkItems(): WorkItem[] {
	return ORDERED_COLUMN_IDS.flatMap((id) => buildColumnItems(id))
}

/** Find a single work item by column + slug (used by the full-screen doc route). */
export function findWorkItem(column: string, id: string): WorkItem | undefined {
	if (!isBoardColumnId(column)) return undefined
	return buildColumnItems(column).find((item) => item.id === id)
}

/** Route href for a work item's full-screen doc view. */
export function boardItemHref(item: Pick<WorkItem, 'column' | 'id'>, base = '/board'): string {
	return `${base}/${item.column}/${item.id}`
}
