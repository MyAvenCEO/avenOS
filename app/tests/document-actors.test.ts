import { describe, expect, test } from 'bun:test'
import {
	createDocumentActors,
	type DecodedDocument,
	type DocumentDecoder,
	parseDocumentActorResult
} from '../src/lib/actors/document-actors'
import type { DocumentModelGateway, DocumentModelRequest } from '../src/lib/actors/document-model'
import {
	type ClientArtifactGateway,
	type ClientRunPublication,
	DocumentProcessingRuntime
} from '../src/lib/artifacts/document-runtime'

const DOCUMENT: DecodedDocument = {
	outcome: 'ok',
	detectedMediaType: 'application/pdf',
	encrypted: false,
	pages: [
		{
			page: 1,
			rotation: 0,
			width: 600,
			height: 800,
			runs: [
				{ text: 'Invoice', x: 100_000, y: 100_000, width: 120_000, height: 20_000 },
				{ text: '42', x: 230_000, y: 100_000, width: 30_000, height: 20_000 }
			]
		},
		{
			page: 2,
			rotation: 0,
			width: 800,
			height: 600,
			runs: [{ text: 'Total €12', x: 100_000, y: 200_000, width: 160_000, height: 20_000 }]
		}
	]
}

class FixedDecoder implements DocumentDecoder {
	constructor(private readonly document: DecodedDocument = DOCUMENT) {}
	async decode(): Promise<DecodedDocument> {
		return structuredClone(this.document)
	}
}

class RecordingGateway implements ClientArtifactGateway {
	runs: ClientRunPublication[] = []
	async publish(run: ClientRunPublication) {
		this.runs.push(structuredClone(run))
		return {
			publicationId: run.publicationId,
			runId: `run-${this.runs.length}`,
			replayed: false,
			artifacts: run.artifacts.map((artifact) => ({
				localKey: artifact.localKey,
				artifactId: `${run.publicationId}:${artifact.localKey}`
			}))
		}
	}
}

class InvoiceModelGateway implements DocumentModelGateway {
	requests: DocumentModelRequest[] = []
	async status() {
		return { available: true, maxPages: 15 }
	}
	async complete(request: DocumentModelRequest) {
		this.requests.push(structuredClone(request))
		const receipt = {
			model: 'vision-test',
			profile: 'openai-json-schema',
			requestKey: `request-${this.requests.length}`,
			promptDigest: 'prompt-digest',
			implementationDigest: 'implementation-digest'
		}
		if (request.procedure === 'analyze-page') {
			const page = request.images[0]?.page ?? 1
			const text = page === 1 ? 'Invoice 42' : 'Total EUR 12.00'
			return {
				receipt,
				structured: {
					text,
					language: 'en',
					complete: true,
					blocks: [{ text, x: 10, y: 20, width: 300, height: 40 }],
					primaryKind: 'document',
					facets: ['raster-text'],
					confidenceBps: 9800,
					reason: 'Visible document text.',
					summary: `Invoice page ${page}.`,
					topics: ['invoice']
				}
			}
		}
		if (request.procedure === 'classify-document') {
			return {
				receipt,
				structured: {
					rawKind: 'invoice',
					resolvedKind: 'invoice',
					family: 'invoice-family',
					confidenceBps: 9900,
					reason: 'The pages visibly form an invoice.',
					resolutionMode: 'model',
					alternatives: []
				}
			}
		}
		return {
			receipt,
			structured: {
				candidate: {
					supplier: 'ACME GmbH',
					invoiceNumber: '42',
					currency: 'EUR',
					netMinor: 1000,
					taxMinor: 200,
					grossMinor: 1200,
					dueDate: null,
					summary: 'Invoice 42 for EUR 12.00.'
				},
				details: {
					documentKind: 'invoice',
					supplier: { name: 'ACME GmbH' }
				},
				evidence: []
			}
		}
	}
}

class FlakyInvoiceModelGateway extends InvoiceModelGateway {
	#failedClassification = false

	override async complete(request: DocumentModelRequest) {
		if (request.procedure === 'classify-document' && !this.#failedClassification) {
			this.#failedClassification = true
			this.requests.push(structuredClone(request))
			throw new Error('transient model failure')
		}
		return super.complete(request)
	}
}

class OnceFailingPublicationGateway extends RecordingGateway {
	#failed = false

	override async publish(run: ClientRunPublication) {
		if (!this.#failed) {
			this.#failed = true
			throw new Error('transient publication failure')
		}
		return super.publish(run)
	}
}

const SOURCE = {
	artifactId: '11111111-1111-4111-8111-111111111111',
	originalName: 'invoice.pdf',
	declaredMediaType: 'application/pdf',
	base64: 'eA=='
}

describe('client document actors', () => {
	test('advertise invocable method-level contracts', () => {
		const actors = createDocumentActors(new FixedDecoder())
		expect(actors.inspect.manifest.methods[0]).toMatchObject({
			name: 'document_inspect',
			requires: ['file(F)'],
			produces: ['file_inspection(F, I)']
		})
		expect(actors.aggregate.manifest.methods[0]).toMatchObject({
			name: 'document_aggregate_content',
			produces: ['content_classification(F, C)']
		})
	})

	test('native text actor emits UTF-8 byte ranges and a blob', async () => {
		const actors = createDocumentActors(new FixedDecoder())
		const response = await actors.extractText.deliver('document_extract_native_text', {
			page: DOCUMENT.pages[1]
		})
		const result = parseDocumentActorResult(response.record)
		const text = result.artifacts.find((artifact) => artifact.localKey === 'text')
		const layout = result.artifacts.find((artifact) => artifact.localKey === 'layout')

		expect(text?.payload).toMatchObject({ method: 'native', pageCount: 1, characterCount: 9 })
		expect(text?.blob?.mediaType).toBe('text/plain; charset=utf-8')
		expect(layout?.payload.spans).toEqual([
			expect.objectContaining({ start: 0, endExclusive: 11, page: 2 })
		])
	})

	test('fails closed when any decoder exceeds the shared page bound', async () => {
		const pages = Array.from({ length: 64 }, (_, index) => ({
			page: index + 1,
			rotation: 0 as const,
			width: 100,
			height: 200,
			runs: []
		}))
		const actors = createDocumentActors(
			new FixedDecoder({
				outcome: 'ok',
				detectedMediaType: 'application/pdf',
				encrypted: false,
				pages
			})
		)
		const response = await actors.inspect.deliver('document_inspect', { source: SOURCE })

		expect(() => parseDocumentActorResult(response.record)).toThrow('maximum is 63')
	})

	test('runs the complete deterministic DAG and binds every hop to persisted artifacts', async () => {
		const gateway = new RecordingGateway()
		const runtime = new DocumentProcessingRuntime(createDocumentActors(new FixedDecoder()), gateway)
		const presentation = await runtime.start(SOURCE)

		expect(presentation.state).toBe('succeeded')
		expect(presentation.preferredType).toBe('document')
		expect(presentation.stages.map((stage) => stage.key)).toEqual([
			'inspect',
			'decompose-pages',
			'extract-native-page-001',
			'classify-page-001',
			'extract-native-page-002',
			'classify-page-002',
			'assemble-document',
			'aggregate-content'
		])
		expect(presentation.stages.every((stage) => stage.state === 'succeeded')).toBe(true)
		expect(gateway.runs).toHaveLength(8)
		expect(gateway.runs[1]?.inputs.map((value) => value.role)).toEqual(['source', 'inspection'])
		expect(gateway.runs[3]?.inputs.map((value) => value.role)).toEqual(['source', 'page', 'text'])
		expect(gateway.runs.at(-1)?.procedureKey).toBe('client.aggregate-content-classification')
		expect(presentation.derivedArtifacts).toHaveLength(12)
	})

	test('derives stable publication identities so a fresh runtime replays after a crash', async () => {
		const first = new RecordingGateway()
		const second = new RecordingGateway()
		await new DocumentProcessingRuntime(createDocumentActors(new FixedDecoder()), first).start(
			SOURCE
		)
		await new DocumentProcessingRuntime(createDocumentActors(new FixedDecoder()), second).start(
			SOURCE
		)

		expect(first.runs.map((run) => run.publicationId)).toEqual(
			second.runs.map((run) => run.publicationId)
		)
	})

	test('preserves a scanned PDF but stops at needs-review while OCR is absent', async () => {
		const gateway = new RecordingGateway()
		const image: DecodedDocument = {
			outcome: 'ok',
			detectedMediaType: 'application/pdf',
			encrypted: false,
			pages: [{ page: 1, rotation: 0, width: 100, height: 200, runs: [] }]
		}
		const presentation = await new DocumentProcessingRuntime(
			createDocumentActors(new FixedDecoder(image)),
			gateway
		).start(SOURCE)

		expect(presentation.state).toBe('needs_review')
		expect(presentation.preferredType).toBe('unknown')
	})

	test('runs the vision, finance extraction, and validation lane client-side', async () => {
		const publications = new RecordingGateway()
		const model = new InvoiceModelGateway()
		const visualDocument: DecodedDocument = {
			...structuredClone(DOCUMENT),
			pages: DOCUMENT.pages.map((page) => ({
				...structuredClone(page),
				image: { mediaType: 'image/png' as const, base64: 'eA==' }
			}))
		}
		const actors = createDocumentActors(new FixedDecoder(visualDocument), model)
		const presentation = await new DocumentProcessingRuntime(actors, publications, () =>
			model.status()
		).start(SOURCE)

		expect(presentation.state).toBe('succeeded')
		expect(presentation.preferredType).toBe('invoice')
		expect(presentation.metadata).toMatchObject({
			vision: 'model',
			documentKind: 'invoice',
			validationStatus: 'consistent'
		})
		expect(model.requests.map((request) => request.procedure)).toEqual([
			'classify-document',
			'analyze-page',
			'analyze-page',
			'extract-invoice'
		])
		expect(JSON.stringify(model.requests.at(-1)?.schema)).not.toContain('$ref')
		expect(presentation.stages.map((stage) => stage.key)).toEqual([
			'inspect',
			'decompose-pages',
			'extract-native-page-001',
			'extract-native-page-002',
			'classify-document',
			'analyze-page-001',
			'analyze-page-002',
			'assemble-document',
			'aggregate-content',
			'extract-invoice',
			'validate-invoice'
		])
		expect(
			publications.runs.find((run) => run.procedureKey === 'client.analyze-page-model')?.parameters
				.modelReceipt
		).toMatchObject({ model: 'vision-test' })
		expect(
			presentation.derivedArtifacts.some(
				(artifact) => artifact.typeKey === 'bookkeeping.invoice-validation'
			)
		).toBe(true)
	})

	test('retries model-backed stages with visible attempt accounting', async () => {
		const model = new FlakyInvoiceModelGateway()
		const visualDocument: DecodedDocument = {
			...structuredClone(DOCUMENT),
			pages: DOCUMENT.pages.map((page) => ({
				...structuredClone(page),
				image: { mediaType: 'image/png' as const, base64: 'eA==' }
			}))
		}
		const presentation = await new DocumentProcessingRuntime(
			createDocumentActors(new FixedDecoder(visualDocument), model),
			new RecordingGateway(),
			() => model.status()
		).start(SOURCE)

		expect(presentation.state).toBe('succeeded')
		expect(
			presentation.stages.find((stage) => stage.key === 'classify-document')?.attemptCount
		).toBe(2)
		expect(
			model.requests.filter((request) => request.procedure === 'classify-document')
		).toHaveLength(2)
	})

	test('allows a failed presentation to be started again', async () => {
		const gateway = new OnceFailingPublicationGateway()
		const runtime = new DocumentProcessingRuntime(createDocumentActors(new FixedDecoder()), gateway)

		expect((await runtime.start(SOURCE)).state).toBe('failed')
		expect((await runtime.start(SOURCE)).state).toBe('succeeded')
	})

	test('ports the server payment-receipt validation rules exactly', async () => {
		const actors = createDocumentActors(new FixedDecoder())
		const response = await actors.validateStatement.deliver('document_validate_statement', {
			candidate: {
				statementKind: 'payment-receipt',
				openingBalanceMinor: 5000,
				closingBalanceMinor: 3800,
				periodStart: '2026-08-01',
				periodEnd: '2026-08-01',
				transactions: [{ amountMinor: -1200 }]
			}
		})
		const result = parseDocumentActorResult(response.record)

		expect(result.artifacts[0]?.payload).toMatchObject({
			rulesetVersion: 'statement-core-v1',
			status: 'consistent',
			coverageBps: 10_000,
			checks: [
				expect.objectContaining({ outcome: 'PASS' }),
				expect.objectContaining({ outcome: 'PASS' }),
				expect.objectContaining({ outcome: 'PASS' })
			]
		})
	})
})
