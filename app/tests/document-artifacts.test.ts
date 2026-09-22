import { describe, expect, test } from 'bun:test'
import {
	documentArtifactGroups,
	documentArtifactLabel,
	documentArtifactPreview,
	isIntentDocument,
	pageSourceLocator
} from '../src/lib/intents/document-artifacts'
import type { MockArtifact } from '../src/lib/intents/intents.svelte'

const artifact = (id: string, typeKey: string, sources?: string[]): MockArtifact => ({
	kind: 'doc',
	title: 'same-name.pdf',
	note: '',
	artifactId: id,
	typeKey,
	...(sources ? { sourceArtifactIds: sources, stageKey: 'extract' } : {})
})
describe('Intent document view', () => {
	test('page preview follows one exact source edge, not the page number or a different document', () => {
		const locator = { kind: 'byte-range' as const, start: 12, endExclusive: 48 }
		const edge = {
			ordinal: 0,
			outputArtifactId: 'page-a',
			outputLocator: { kind: 'artifact-root' as const },
			inputArtifactId: 'source-a',
			inputRole: 'source',
			inputOrdinal: 0,
			inputLocator: locator
		}
		const resource = { artifactId: 'page-a', evidence: [edge] }
		expect(pageSourceLocator(resource, 'page-a', 'source-a')).toEqual(locator)
		expect(pageSourceLocator(resource, 'page-a', 'source-b')).toBeNull()
		expect(pageSourceLocator(resource, 'page-b', 'source-a')).toBeNull()
		expect(
			pageSourceLocator({ ...resource, evidence: [edge, edge] }, 'page-a', 'source-a')
		).toEqual(locator)
		expect(
			pageSourceLocator(
				{ ...resource, evidence: [edge, { ...edge, inputLocator: { ...locator, start: 13 } }] },
				'page-a',
				'source-a'
			)
		).toBeNull()
		for (const invalid of [
			{ ...locator, start: -1 },
			{ ...locator, endExclusive: 12 },
			{ kind: 'page-region' as const, page: 0, x: 0, y: 0, width: 100, height: 100 }
		])
			expect(
				pageSourceLocator(
					{ ...resource, evidence: [{ ...edge, inputLocator: invalid }] },
					'page-a',
					'source-a'
				)
			).toBeNull()
	})
	test('sidebar hides processing and derived facts, but keeps documents and authored skills', () => {
		const rows = [
			'core.file-inspection',
			'core.document-classification',
			'core.content-description',
			'docs.page',
			'docs.extracted-text',
			'bookkeeping.invoice-candidate',
			'banking.transaction',
			'knowledge.fact'
		].map((key, i) => artifact(String(i), key))
		rows.push(artifact('new-actor', 'extension.some-new-output', ['A']))
		expect(rows.filter(isIntentDocument)).toEqual([])
		expect(isIntentDocument(artifact('A', 'core.file'))).toBe(true)
		expect(isIntentDocument(artifact('skill', 'studio.skill'))).toBe(true)
	})
	test('grouping requires exact source IDs, never same title, Intent, stage or type', () => {
		const a = artifact('result-a', 'docs.extracted-text', ['A'])
		const b = artifact('result-b', 'docs.extracted-text', ['B'])
		const shared = artifact('shared', 'bookkeeping.invoice-validation', ['A', 'B'])
		const orphan = artifact('unknown', 'docs.extracted-text')
		const rows = [artifact('A', 'core.file'), a, b, shared, orphan, a]
		expect(
			documentArtifactGroups(rows, 'A')
				.flatMap((g) => g.items.map((a) => a.artifactId))
				.sort()
		).toEqual(['result-a', 'shared'])
		expect(
			documentArtifactGroups(rows, 'B')
				.flatMap((g) => g.items.map((a) => a.artifactId))
				.sort()
		).toEqual(['result-b', 'shared'])
		expect(documentArtifactGroups(rows, 'C')).toEqual([])
	})
	test('previews show useful bounded data without inventing values or exposing type keys', () => {
		expect(documentArtifactLabel('core.document-classification')).toBe('Dokumentart')
		expect(documentArtifactLabel('extension.new-kind')).toBe('New kind')
		expect(
			documentArtifactPreview({
				supplier: { name: 'Example' },
				invoiceNumber: 'R-12',
				grossMinor: 1995,
				currency: 'EUR'
			})
		).toContain('19,95')
		expect(documentArtifactPreview({ text: 'x'.repeat(10000) }).length).toBe(180)
		expect(documentArtifactPreview({ sourcePage: 4 })).toBe('Seite 4')
		expect(
			documentArtifactPreview({
				statement: { transactions: [{}, {}], currency: 'EUR' },
				reason: 'long explanation'
			})
		).toBe('2 Buchungen · EUR')
		expect(documentArtifactPreview({})).toBe('Details ansehen')
	})
})
