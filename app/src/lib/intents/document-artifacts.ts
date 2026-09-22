import type { ArtifactLocator, EvidenceResource } from '$lib/artifacts/artifact-view'
import { formatMoney, objectValue } from '$lib/artifacts/artifact-view'
import type { MockArtifact } from './intents.svelte'

/** A page view must have one exact, non-ambiguous link to the selected original. */
export function pageSourceLocator(
	resource: EvidenceResource,
	pageId: string,
	sourceId: string
): ArtifactLocator | null {
	if (resource.artifactId !== pageId || !Array.isArray(resource.evidence)) return null
	const locations = resource.evidence
		.filter(
			(edge) =>
				edge.outputArtifactId === pageId &&
				edge.inputArtifactId === sourceId &&
				edge.outputLocator?.kind === 'artifact-root'
		)
		.map((edge) => edge.inputLocator)
		.filter((locator) => {
			if (locator?.kind === 'byte-range')
				return (
					Number.isSafeInteger(locator.start) &&
					locator.start >= 0 &&
					Number.isSafeInteger(locator.endExclusive) &&
					locator.endExclusive > locator.start
				)
			if (locator?.kind !== 'page-region') return false
			return (
				Number.isSafeInteger(locator.page) &&
				locator.page > 0 &&
				[locator.x, locator.y, locator.width, locator.height].every(
					(n) => Number.isSafeInteger(n) && n >= 0
				) &&
				locator.width > 0 &&
				locator.height > 0 &&
				locator.x + locator.width <= 1_000_000 &&
				locator.y + locator.height <= 1_000_000
			)
		})
	const unique = new Map(locations.map((locator) => [JSON.stringify(locator), locator]))
	return unique.size === 1 ? [...unique.values()][0]! : null
}

/** User-facing documents and authored outputs, not the internal processing inventory. */
export function isIntentDocument(artifact: MockArtifact): boolean {
	if (['core.file', 'studio.skill', 'studio.email'].includes(artifact.typeKey ?? '')) return true
	if (artifact.relation === 'file-skill-output' || artifact.stageKey) return false
	return !/^(docs\.|bookkeeping\.|banking\.|knowledge\.|core\.(file-inspection|content-|document-))/.test(
		artifact.typeKey ?? ''
	)
}

const labels: Record<string, string> = {
	'core.file-inspection': 'Dateiprüfung',
	'core.content-classification': 'Dokumenttyp',
	'core.document-classification': 'Dokumentart',
	'core.content-description': 'Zusammenfassung',
	'docs.page': 'Seiten',
	'docs.extracted-text': 'Erkannter Text',
	'docs.text-layout': 'Textpositionen',
	'docs.page-signals': 'Seitenmerkmale',
	'docs.page-analysis': 'Seitenanalyse',
	'docs.document': 'Zusammengeführtes Dokument',
	'docs.content': 'Dokumentinhalt',
	'bookkeeping.invoice-candidate': 'Rechnungsangaben',
	'bookkeeping.invoice-details': 'Rechnungsdetails',
	'bookkeeping.invoice-validation': 'Rechnungsprüfung',
	'bookkeeping.invoice-open-item': 'Offene Posten',
	'bookkeeping.open-item': 'Offene Posten',
	'banking.csv-statement-detection': 'CSV-Zuordnung',
	'banking.csv-statement-confirmation': 'CSV-Bestätigung',
	'banking.account-statement-candidate': 'Kontoauszug',
	'banking.statement-validation': 'Auszugsprüfung',
	'banking.statement-normalized': 'Aufbereiteter Kontoauszug',
	'banking.statement': 'Aufbereiteter Kontoauszug',
	'banking.transaction': 'Buchungen',
	'bookkeeping.reconciliation-candidate': 'Abgleichsvorschläge',
	'knowledge.observation': 'Beobachtungen',
	'knowledge.fact': 'Abgeleitete Fakten'
}
export function documentArtifactLabel(typeKey: string): string {
	return (
		labels[typeKey] ??
		typeKey
			.split('.')
			.at(-1)!
			.replace(/[-_]/g, ' ')
			.replace(/^./, (c) => c.toUpperCase())
	)
}
export function documentArtifactGroups(artifacts: readonly MockArtifact[], sourceId: string) {
	const groups = new Map<string, MockArtifact[]>()
	const seen = new Set<string>()
	for (const artifact of artifacts) {
		if (
			!artifact.artifactId ||
			artifact.artifactId === sourceId ||
			seen.has(artifact.artifactId) ||
			!artifact.sourceArtifactIds?.includes(sourceId)
		)
			continue
		seen.add(artifact.artifactId)
		const type = artifact.typeKey ?? 'other'
		groups.set(type, [...(groups.get(type) ?? []), artifact])
	}
	return [...groups]
		.map(([typeKey, items]) => ({ typeKey, label: documentArtifactLabel(typeKey), items }))
		.sort(
			(a, b) =>
				Number(a.typeKey.startsWith('docs.')) - Number(b.typeKey.startsWith('docs.')) ||
				a.label.localeCompare(b.label)
		)
}
const short = (v: unknown) =>
	typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 180) : ''
/** Small factual preview. Unknowns stay unknown; no generated interpretation. */
export function documentArtifactPreview(payload: unknown): string {
	const p = objectValue(payload),
		supplier = objectValue(p.supplier)
	const money = p.grossMinor ?? p.amountMinor ?? objectValue(p.totals).grossMinor
	const parts = [
		short(supplier.name ?? p.counterpartyName),
		short(p.invoiceNumber ?? p.bookingDate)
	]
	if (money !== undefined && typeof p.currency === 'string')
		parts.push(formatMoney(money, p.currency))
	if (parts.some(Boolean)) return parts.filter(Boolean).join(' · ')
	const statement = objectValue(p.statement)
	if (Array.isArray(statement.transactions))
		return [`${statement.transactions.length} Buchungen`, short(statement.currency)]
			.filter(Boolean)
			.join(' · ')
	for (const key of [
		'summary',
		'description',
		'text',
		'primaryKind',
		'reason',
		'outcome',
		'decision'
	]) {
		const value = short(p[key])
		if (value) return value
	}
	if (typeof p.sourcePage === 'number') return `Seite ${p.sourcePage}`
	if (typeof p.pageCount === 'number') return `${p.pageCount} Seiten`
	if (Array.isArray(p.transactions)) return `${p.transactions.length} Buchungen`
	if (typeof p.characterCount === 'number')
		return `${p.characterCount.toLocaleString('de-DE')} Zeichen`
	return 'Details ansehen'
}
