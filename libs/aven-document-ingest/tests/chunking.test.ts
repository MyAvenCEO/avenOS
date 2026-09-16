import { expect, test } from 'vitest'
import invoiceProof from '../../../review-evidence/real-model/invoice-six-items.json'
import { GoldenInvoiceModel } from '../../../services/actor-runner/tests/support/golden-document-model'
import { createDocumentActors } from '../src/actors/registry'
import { mergeFinance } from '../src/chunks'
import { decodePlainText, renderScale } from '../src/decoding'
import { DocumentProcessingRuntime } from '../src/runtime'
import { ServerDocumentDecoder } from '../src/server'
import { decodedPage } from '../src/shared'
import { documentSource, textPdf } from './support/chunk-fixtures'
import { CsvMemoryGateway } from './support/csv-corpus'

test('one multi-page model import uses independent actor lanes up to the advertised capacity', async () => {
	const model = new GoldenInvoiceModel()
	const complete = model.complete.bind(model)
	let active = 0
	let peak = 0
	model.complete = async (request) => {
		active++
		peak = Math.max(peak, active)
		await new Promise((resolve) => setTimeout(resolve, 12))
		try {
			return await complete(request)
		} finally {
			active--
		}
	}
	model.status = async () => ({ available: true, maxPages: 15, maxParallelism: 5 })
	const decoder = new ServerDocumentDecoder()
	const createActors = () => createDocumentActors(decoder, model)
	const actors = createActors()
	const source = documentSource(
		textPdf(Array.from({ length: 5 }, (_, index) => [`Invoice page ${index + 1}`])),
		'invoice.pdf'
	)
	const runtime = new DocumentProcessingRuntime(
		actors,
		new CsvMemoryGateway(),
		() => model.status(),
		{},
		createActors
	)
	try {
		const result = await runtime.start(source)
		expect(peak).toBe(5)
		expect(result.metadata.completedChunks).toBe(5)
		expect(result.state).not.toBe('failed')
	} finally {
		await runtime.close()
	}
}, 120000)

test('a context row copied into another invoice chunk requires review and grounds validation in details', async () => {
	for (const duplicate of [false, true]) {
		const model = new GoldenInvoiceModel()
		const baseComplete = model.complete.bind(model)
		model.complete = async (request) => {
			const response = await baseComplete(request)
			if (request.procedure !== 'extract-invoice') return response
			const page = (request.images[0]?.page ?? 1) - 1
			const [candidate, details] = structuredClone(invoiceProof.parts[page]!)
			if (duplicate && page === 1)
				(details as { lineItems: unknown[] }).lineItems.push(
					structuredClone((invoiceProof.parts[0]![1] as { lineItems: unknown[] }).lineItems[0])
				)
			return { ...response, structured: { candidate, details, evidence: [] } } as typeof response
		}
		const gateway = new CsvMemoryGateway(),
			actors = createDocumentActors(new ServerDocumentDecoder(), model)
		const source = documentSource(
			textPdf([['Invoice page one'], ['Invoice page two']]),
			'invoice.pdf'
		)
		try {
			const result = await new DocumentProcessingRuntime(actors, gateway, () =>
				model.status()
			).start(source)
			expect(result.metadata.validationStatus, JSON.stringify(result)).toBe(
				duplicate ? 'insufficient-coverage' : 'consistent'
			)
			expect(result.state).toBe(duplicate ? 'needs_review' : 'succeeded')
			const validation = gateway.runs.find((run) => run.procedureKey === 'client.validate-invoice')!
			expect(validation.inputs).toEqual(
				expect.arrayContaining([expect.objectContaining({ role: 'details' })])
			)
			expect(validation.parameters).toMatchObject({ rulesetVersion: 'invoice-core-v2' })
			const count = gateway.runs.length
			const replay = await new DocumentProcessingRuntime(actors, gateway, () =>
				model.status()
			).start(source)
			expect(replay.metadata.validationStatus).toBe(result.metadata.validationStatus)
			expect(gateway.runs).toHaveLength(count)
		} finally {
			for (const actor of actors.all) actor.dispose()
		}
	}
})

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
