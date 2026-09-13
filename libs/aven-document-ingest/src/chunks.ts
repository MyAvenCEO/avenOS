import { type ArtifactJson, canonicalArtifactJsonText } from '@avenos/artifact-store'
import type {
	ClientEvidence,
	DecodedDocument,
	DocumentDecoder,
	DocumentSource,
	ExtractedPage
} from './shared'
import { artifact, decodedPage, object, wholeArtifact } from './shared'

export const DOCUMENT_PAGE_BATCH = 32
export const MAX_FINANCE_ROWS = 10_000
export type ChunkPart = { candidate: Record<string, unknown>; details?: Record<string, unknown> }

/** Only the owned page contributes rows; surrounding text supplies document identity and totals. */
export function chunkContext(pages: ExtractedPage[], owned: number): string {
	const context = [pages[0], pages.at(-1)].filter(
		(page, i, all) =>
			page && page.page !== owned && all.findIndex((other) => other?.page === page.page) === i
	)
	return context
		.map((page) => `Context from source page ${page?.page}:\n${page?.text.slice(0, 4000)}`)
		.join('\n\n')
}
export async function renderedDocument(
	document: DecodedDocument,
	decoder?: DocumentDecoder,
	source?: DocumentSource
): Promise<DecodedDocument> {
	const pages = []
	for (const page of document.pages) pages.push(await decodedPage(decoder, source, page, true))
	return { ...document, pages }
}

export function mergeKinds(parts: Record<string, unknown>[]): Record<string, unknown> {
	if (!parts.length) throw new Error('No classification chunks were completed')
	const accepted = parts.filter((part) => part.family !== 'unknown')
	const kinds = new Set(accepted.map((part) => part.resolvedKind))
	const first = accepted[0]
	const agreed = first && kinds.size === 1
	return {
		rawKind: agreed ? first.rawKind : 'unknown',
		resolvedKind: agreed ? first.resolvedKind : 'unknown',
		family: agreed ? first.family : 'unknown',
		confidenceBps: agreed ? Math.min(...accepted.map((part) => Number(part.confidenceBps))) : 0,
		reason: agreed
			? `Combined ${parts.length} source chunks; supported classifications agree on ${first.resolvedKind}.`
			: `The ${parts.length} source chunks have no unambiguous supported document kind.`,
		resolutionMode: 'rule',
		alternatives: []
	}
}

/** Merge disjoint source ranges. Equal-looking rows remain distinct; metadata disagreements are explicit. */
export function mergeFinance(parts: ChunkPart[], invoice: boolean) {
	if (!parts.length) throw new Error('No extraction chunks were completed')
	const conflicts: string[] = []
	const rowPaths = new Set([
		'/candidate/transactions',
		'/details/lineItems',
		'/details/payments',
		'/details/referenceEntries'
	])
	const merge = (values: unknown[], path: string): unknown => {
		const present = values.filter((value) => value !== null && value !== undefined && value !== '')
		if (!present.length) return null
		if (Array.isArray(present[0])) {
			const arrays = present as unknown[][]
			if (path === '/details/taxBreakdown') {
				// Tax breakdown is a document-wide summary, not a disjoint line-item collection.
				const summaries = arrays.filter((array) => array.length)
				const identity = (array: unknown[]) =>
					JSON.stringify(
						array.map((value) => canonicalArtifactJsonText(value as ArtifactJson)).sort()
					)
				if (new Set(summaries.map(identity)).size > 1 && conflicts.length < 128)
					conflicts.push(path)
				return summaries[0] ?? []
			}
			const combined = arrays.flat()
			if (combined.length > MAX_FINANCE_ROWS)
				throw new Error(`Combined ${path} exceeds the ${MAX_FINANCE_ROWS} row safety limit`)
			return rowPaths.has(path)
				? combined
				: [...new Map(combined.map((value) => [JSON.stringify(value), value])).values()]
		}
		if (typeof present[0] === 'object') {
			const keys = [...new Set(present.flatMap((value) => Object.keys(value as object)))]
			return Object.fromEntries(
				keys.map((key) => [
					key,
					merge(
						values.map((value) => value && (value as Record<string, unknown>)[key]),
						`${path}/${key}`
					)
				])
			)
		}
		if (
			new Set(present.map((value) => JSON.stringify(value))).size > 1 &&
			!path.endsWith('/summary') &&
			!path.endsWith('/notes')
		) {
			if (conflicts.length < 128) conflicts.push(path)
		}
		return present[0]
	}
	const candidate = object(
		merge(
			parts.map((part) => part.candidate),
			'/candidate'
		),
		'combined candidate'
	)
	const details = invoice
		? object(
				merge(
					parts.map((part) => part.details),
					'/details'
				),
				'combined invoice details'
			)
		: undefined
	const transactions = candidate.transactions
	if (Array.isArray(transactions)) {
		const ids = transactions
			.map((row) => (row as Record<string, unknown>).transactionId)
			.filter((id) => typeof id === 'string' && id.length > 0)
		if (new Set(ids).size !== ids.length && conflicts.length < 128)
			conflicts.push('/candidate/transactions/duplicate-transactionId')
	}
	const limited = parts.some(
		(part) =>
			String(part.candidate.notes ?? '').startsWith('[ROW_LIMIT_REACHED]') ||
			(Array.isArray(part.candidate.transactions) && part.candidate.transactions.length >= 128) ||
			(invoice &&
				Object.entries({
					lineItems: 128,
					taxBreakdown: 64,
					payments: 128,
					referenceEntries: 64
				}).some(
					([key, limit]) =>
						Array.isArray(part.details?.[key]) && (part.details![key] as unknown[]).length >= limit
				))
	)
	const coverage = {
		total: parts.length,
		completed: parts.length,
		complete: !limited && conflicts.length === 0,
		conflicts
	}
	candidate.chunkCoverage = coverage
	if (details) details.chunkCoverage = coverage
	const artifacts = invoice
		? [
				artifact('invoice', 'bookkeeping.invoice-candidate', candidate, 'candidate'),
				artifact('details', 'bookkeeping.invoice-details', details!, 'details')
			]
		: [artifact('statement', 'banking.account-statement-candidate', candidate, 'candidate')]
	const evidence: ClientEvidence[] = []
	// Every chunk is a production input. Bounded evidence roots retain direct provenance without inventing locations.
	for (const [index] of parts.entries()) {
		if (evidence.length >= 256) break
		for (const output of artifacts) {
			if (evidence.length >= 256) break
			evidence.push({
				ordinal: evidence.length,
				outputLocalKey: output.localKey,
				outputLocator: wholeArtifact(),
				inputRole: output.output.role === 'details' ? 'details' : 'candidate',
				inputOrdinal: index,
				inputLocator: wholeArtifact()
			})
		}
	}
	return { candidate, details, artifacts, evidence }
}
