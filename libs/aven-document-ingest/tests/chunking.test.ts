import { expect, test } from 'vitest'
import { createDocumentActors } from '../src/actors/registry'
import { mergeFinance } from '../src/chunks'
import { decodePlainText, renderScale } from '../src/decoding'
import { DocumentProcessingRuntime } from '../src/runtime'
import { ServerDocumentDecoder } from '../src/server'
import { decodedPage } from '../src/shared'
import { documentSource, textPdf } from './support/chunk-fixtures'
import { CsvMemoryGateway } from './support/csv-corpus'

test('preserves all 70 PDF pages through bounded publications and replays without decoding', async () => {
	const bytes = textPdf(
		Array.from({ length: 70 }, (_, i) => [
			`Operations manual section ${i + 1}`,
			`UNIQUE-PAGE-${i + 1}`
		])
	)
	const source = documentSource(bytes),
		gateway = new CsvMemoryGateway()
	const decoder = new ServerDocumentDecoder(),
		actors = createDocumentActors(decoder)
	const result = await new DocumentProcessingRuntime(actors, gateway).start(source)
	expect(result.metadata.completedChunks, JSON.stringify(result)).toBe(70)
	const text = gateway.runs
		.filter((run) => run.procedureKey === 'client.extract-native-text')
		.map((run) => Buffer.from(run.artifacts[0]?.blob?.base64, 'base64').toString())
		.join('\n')
	for (let i = 1; i <= 70; i++) expect(text).toContain(`UNIQUE-PAGE-${i}`)
	expect(gateway.runs.every((run) => run.artifacts.length <= 64)).toBe(true)
	expect(gateway.runs.filter((run) => run.procedureKey === 'client.decompose-pages')).toHaveLength(
		3
	)
	for (const actor of actors.all) actor.dispose()
	const replayActors = createDocumentActors({
		decode: async () => {
			throw new Error('Replay decoded a completed source')
		}
	})
	const replay = await new DocumentProcessingRuntime(replayActors, gateway).start(source)
	expect(replay.metadata.completedChunks).toBe(70)
	expect(replay.stages.every((stage) => stage.attemptCount === 0)).toBe(true)
	for (const actor of replayActors.all) actor.dispose()
}, 120000)

test('UTF-8 text chunks retain every byte, including multibyte boundaries and repeated rows', () => {
	const bytes = new TextEncoder().encode('Repeated row € 漢字\n'.repeat(8000))
	const source = documentSource(bytes, 'long.txt')
	const decoded = decodePlainText(source, bytes, { modelPageLimit: 0, metadataOnly: true })!
	expect(decoded.pages.length).toBeGreaterThan(8)
	const chunks = decoded.pages.map(
		(page) =>
			decodePlainText(source, bytes, {
				modelPageLimit: 0,
				pageRange: { start: page.page, count: 1 },
				textRange: page.textRange
			})?.pages[0]?.runs[0]?.text
	)
	expect(chunks.join('')).toBe(new TextDecoder().decode(bytes))
	expect(decoded.pages.every((page) => page.deferred && page.runs.length === 0)).toBe(true)
})

test('merges more than 128 rows without deleting identical legitimate transactions and flags conflicts', () => {
	const parts = Array.from({ length: 4 }, (_, _page) => ({
		candidate: {
			accountIban: 'DE89',
			currency: 'EUR',
			openingBalanceMinor: 20000,
			closingBalanceMinor: 4000,
			summary: 'Statement',
			transactions: Array.from({ length: 40 }, () => ({
				amountMinor: -100,
				description: 'Recurring charge'
			}))
		}
	}))
	const merged = mergeFinance(parts, false)
	expect(merged.candidate.transactions).toHaveLength(160)
	expect(merged.candidate.chunkCoverage).toMatchObject({ complete: true, total: 4 })
	parts[2]!.candidate.currency = 'USD'
	const conflict = mergeFinance(parts, false)
	expect(conflict.candidate.chunkCoverage).toMatchObject({
		complete: false,
		conflicts: ['/candidate/currency']
	})
})

test('long scans keep the same useful render resolution as a one-page scan', () => {
	expect(renderScale(595, 842, 1000)).toBe(renderScale(595, 842, 1))
	expect(renderScale(595, 842, 1000)).toBeGreaterThanOrEqual(2)
})

test('an oversized raster cannot become an empty model request', async () => {
	const page = { page: 1, width: 100, height: 100, rotation: 0, runs: [], deferred: true }
	await expect(
		decodedPage(
			{
				decode: async () => ({
					outcome: 'ok',
					detectedMediaType: 'image/png',
					encrypted: false,
					pages: [{ ...page, deferred: false }]
				})
			},
			documentSource(new Uint8Array(), 'image.png'),
			page,
			true
		)
	).rejects.toThrow('no usable image or text')
})

test('invoice detail collection limits cannot claim complete merged coverage', () => {
	const merged = mergeFinance(
		[
			{
				candidate: { invoiceNumber: 'INV-1' },
				details: {
					referenceEntries: Array.from({ length: 64 }, () => ({ value: 'same-looking reference' }))
				}
			},
			{
				candidate: { invoiceNumber: 'INV-1' },
				details: { referenceEntries: [{ value: 'last reference' }] }
			}
		],
		true
	)
	expect(merged.details?.referenceEntries).toHaveLength(65)
	expect(merged.candidate.chunkCoverage).toMatchObject({ complete: false, total: 2 })
})

test('document-wide tax summaries are not added twice and disagreement still blocks coverage', () => {
	const parts = [
		{
			candidate: { grossMinor: 714 },
			details: { taxBreakdown: [{ rateBps: 1900, baseMinor: 600, taxMinor: 114 }] }
		},
		{
			candidate: { grossMinor: 714 },
			details: { taxBreakdown: [{ taxMinor: 114, baseMinor: 600, rateBps: 1900 }] }
		}
	]
	const merged = mergeFinance(parts, true)
	expect(merged.details?.taxBreakdown).toHaveLength(1)
	expect(merged.candidate.chunkCoverage).toMatchObject({ complete: true })
	parts[1]!.details.taxBreakdown[0]!.taxMinor = 115
	expect(mergeFinance(parts, true).candidate.chunkCoverage).toMatchObject({
		complete: false,
		conflicts: ['/details/taxBreakdown']
	})
})
