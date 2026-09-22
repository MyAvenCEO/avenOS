import type { StudioCatalogActor, StudioCatalogEntry } from '@avenos/actors'

export const studioCategories = [
	{ id: 'documents', label: 'Documents & files', icon: '▤', hint: 'Read, extract, organize' },
	{ id: 'email', label: 'Email & messages', icon: '✉', hint: 'Understand and prepare messages' },
	{ id: 'numbers', label: 'Numbers & analysis', icon: '∑', hint: 'Calculate, compare, round' },
	{
		id: 'finance',
		label: 'Finance & bookkeeping',
		icon: '≋',
		hint: 'Invoices, statements, reconciliation'
	},
	{ id: 'work', label: 'Tasks & workspace', icon: '☑', hint: 'To-dos and ongoing work' },
	{ id: 'conversation', label: 'AI, chat & voice', icon: '◌', hint: 'Generate, listen, speak' },
	{
		id: 'views',
		label: 'Views & navigation',
		icon: '▣',
		hint: 'Open a view or change what you see'
	},
	{ id: 'skills', label: 'Skills & system', icon: '⌘', hint: 'Build procedures and inspect tools' },
	{ id: 'other', label: 'Other tools', icon: '◇', hint: 'More installed capabilities' }
] as const

type CategoryId = (typeof studioCategories)[number]['id']
export interface StudioActorBranch {
	actor: StudioCatalogActor
	entries: StudioCatalogEntry[]
}

/** Presentation only: classification never grants availability or changes a contract. */
export function studioActorCategory(actor: StudioCatalogActor): CategoryId {
	const words = `${actor.tags.join(' ')} ${actor.actorId} ${actor.label}`.toLowerCase()
	if (/\b(window|windows|navigation|ui\.activity)\b/.test(words)) return 'views'
	if (/\b(email|mail|mailbox|imap|message|messages)\b/.test(words)) return 'email'
	if (/\b(numbers|calculator|calculation|arithmetic|knowledge)\b/.test(words)) return 'numbers'
	if (
		/\b(invoice|invoices|statement|statements|reconciliation|bookkeeping|finance|transaction)\b/.test(
			words
		)
	)
		return 'finance'
	if (
		/\b(docs|document|documents|file|files|pdf|page|text-extractor|content-aggregator)\b/.test(
			words
		)
	)
		return 'documents'
	if (/\b(todo|todos|task|tasks|intent|intents|workspace)\b/.test(words)) return 'work'
	if (/\b(voice|chat|llm|ai|listener|speaker|speech)\b/.test(words)) return 'conversation'
	if (/\b(studio|skill|skills|registry|system)\b/.test(words)) return 'skills'
	return 'other'
}

export function studioCatalogTree(
	actors: StudioCatalogActor[],
	entries: StudioCatalogEntry[],
	query = '',
	addableOnly = false
) {
	const branches = new Map<string, StudioActorBranch>(
		actors.map((actor) => [actor.actorId, { actor, entries: [] }])
	)
	for (const entry of entries) {
		let branch = branches.get(entry.actorId)
		if (!branch) {
			branch = {
				actor: {
					actorId: entry.actorId,
					version: entry.version,
					label: entry.actorId,
					description: '',
					tags: entry.tags,
					placements: entry.placements,
					visibleOperationCount: 0,
					kind: 'operations',
					canCompose: entry.canAuthor
				},
				entries: []
			}
			branches.set(entry.actorId, branch)
		}
		branch.entries.push(entry)
	}
	const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
	return studioCategories.flatMap((category) => {
		const children = [...branches.values()]
			.flatMap((branch) => {
				if (studioActorCategory(branch.actor) !== category.id) return []
				const context =
					`${category.label} ${category.hint} ${branch.actor.label} ${branch.actor.description} ${branch.actor.tags.join(' ')} ${branch.actor.actorId}`.toLowerCase()
				const matches = (extra = '') => terms.every((term) => `${context} ${extra}`.includes(term))
				const matching = branch.entries
					.filter(
						(entry) =>
							(!addableOnly || entry.canAuthor) &&
							matches(
								`${entry.label} ${entry.description} ${entry.tags.join(' ')} ${entry.capabilityId}`.toLowerCase()
							)
					)
					.sort(
						(a, b) => a.label.localeCompare(b.label) || a.capabilityId.localeCompare(b.capabilityId)
					)
				if (!matching.length && (addableOnly || !matches())) return []
				return [{ actor: branch.actor, entries: matching }]
			})
			.sort(
				(a, b) =>
					a.actor.label.localeCompare(b.actor.label) ||
					a.actor.actorId.localeCompare(b.actor.actorId)
			)
		return children.length
			? [
					{
						...category,
						children,
						actionCount: children.reduce((n, branch) => n + branch.entries.length, 0)
					}
				]
			: []
	})
}
