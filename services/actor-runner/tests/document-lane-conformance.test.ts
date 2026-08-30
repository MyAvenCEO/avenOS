import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { PlanRunnerClient, PlanRunSecurityContext, PlanRunStartCommand } from '@avenos/actors'
import type {
	ArtifactJson,
	ArtifactProcessingPresentation,
	ArtifactStoreClient,
	ClientRunPublication
} from '@avenos/artifact-store'
import { createDocumentActors } from '@avenos/document-ingest/actors'
import {
	documentPlanRunCommand,
	documentRunStartRequest,
	RemoteDocumentExecutionHost
} from '@avenos/document-ingest/execution'
import type {
	DocumentModelGateway,
	DocumentModelRequest,
	DocumentModelStatus
} from '@avenos/document-ingest/model'
import { DocumentProcessingRuntime } from '@avenos/document-ingest/runtime'
import { createDocumentSkillExecutor } from '@avenos/document-ingest/server'
import { describe, expect, test } from 'vitest'
import { BrowserDocumentDecoder } from '../../../app/src/lib/artifacts/browser-document-decoder.js'
import { MemoryPlanRunner } from '../src/memory-runner.js'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const SECURITY: PlanRunSecurityContext = {
	principal: {
		subjectId: '33333333-3333-4333-8333-333333333333',
		kind: 'user',
		assurance: ['passkey'],
		sessionId: 'document-conformance'
	},
	access: { tenantId: TENANT_ID },
	establishedBy: 'document-conformance',
	authorizedAt: '2026-08-29T00:00:00.000Z'
}

const pdfGolden = new Uint8Array(
	await readFile(
		new URL(
			'../../../fixtures/artifacts/0009_MX_community_garden_mx-2026-00009-z.pdf',
			import.meta.url
		)
	)
)
const imageGolden = new Uint8Array(
	await readFile(
		new URL('../../../fixtures/artifacts/0001_DE_agri_coop_de-2025-00001-k.jpg', import.meta.url)
	)
)

const GOLDEN_DOCUMENTS = [
	{
		name: 'golden-note.txt',
		mediaType: 'text/plain; charset=utf-8',
		bytes: new TextEncoder().encode('A deterministic document.\nSecond line.\n')
	},
	{
		name: 'golden-table.csv',
		mediaType: 'text/csv; charset=utf-8',
		bytes: new TextEncoder().encode('account,amount\nCash,42\n')
	},
	{
		name: '0009_MX_community_garden_mx-2026-00009-z.pdf',
		mediaType: 'application/pdf',
		bytes: pdfGolden
	}
]

class RecordingGateway {
	readonly runs: ClientRunPublication[] = []
	#ordinal = 0

	async publish(run: ClientRunPublication) {
		this.runs.push(structuredClone(run))
		return {
			publicationId: run.publicationId,
			runId: uuid(++this.#ordinal),
			replayed: false,
			artifacts: run.artifacts.map((artifact) => ({
				localKey: artifact.localKey,
				artifactId: uuid(++this.#ordinal)
			}))
		}
	}
}

class FakeArtifactStore {
	readonly publications: Array<Record<string, unknown>> = []
	#ordinal = 100

	constructor(
		private readonly name: string,
		private readonly mediaType: string,
		private readonly bytes: Uint8Array
	) {}

	async artifact(_scopeId: string, artifactId: string): Promise<ArtifactJson> {
		if (artifactId !== SOURCE_ID) throw new Error('unexpected source artifact')
		return {
			artifactId,
			typeKey: 'core.file',
			typeVersion: 1,
			payload: { originalName: this.name, declaredMediaType: this.mediaType }
		}
	}

	async content(): Promise<Uint8Array> {
		return this.bytes.slice()
	}

	async context(): Promise<ArtifactJson> {
		return { storeEpoch: '44444444-4444-4444-8444-444444444444' }
	}

	async upload(
		_scopeId: string,
		_claimId: string,
		_declaration: unknown,
		_bytes: Uint8Array
	): Promise<ArtifactJson> {
		return { staged: true }
	}

	async publish(
		_scopeId: string,
		publicationId: string,
		_storeEpoch: string,
		submission: { intent: ArtifactJson; blobAuthorities: ArtifactJson }
	): Promise<ArtifactJson> {
		const intent = record(submission.intent)
		this.publications.push(structuredClone(intent))
		const artifacts = array(intent.artifacts).map((value) => {
			const artifact = record(value)
			return { localKey: artifact.localKey as string, artifactId: uuid(++this.#ordinal) }
		})
		return {
			publicationId,
			runId: uuid(++this.#ordinal),
			replayed: false,
			artifacts
		}
	}
}

class GoldenInvoiceModel implements DocumentModelGateway {
	readonly requests: DocumentModelRequest[] = []
	constructor(private readonly kind: 'invoice' | 'bank-statement' = 'invoice') {}

	async status(): Promise<DocumentModelStatus> {
		return { available: true, maxPages: 15, modelId: 'golden-vision', modelLabel: 'Golden Vision' }
	}

	async complete(request: DocumentModelRequest) {
		this.requests.push(structuredClone(request))
		const receipt = {
			model: 'golden-vision',
			modelLabel: 'Golden Vision',
			profile: 'deterministic-golden',
			requestKey: `golden-${request.procedure}-${request.images[0]?.page ?? 0}`,
			promptDigest: 'golden-prompt',
			implementationDigest: 'golden-implementation'
		}
		if (request.procedure === 'analyze-page') {
			return {
				receipt,
				structured: {
					text: 'Rechnung DE-2025-00001\nNetto 100,00 EUR\nMwSt 19,00 EUR\nGesamt 119,00 EUR',
					language: 'de',
					complete: true,
					blocks: [{ text: 'Rechnung DE-2025-00001', x: 1000, y: 1000, width: 3000, height: 500 }],
					primaryKind: 'document',
					facets: ['raster-text', 'table'],
					confidenceBps: 9900,
					reason: 'The page visibly contains an invoice.',
					summary: 'German invoice DE-2025-00001.',
					topics: ['invoice']
				}
			}
		}
		if (request.procedure === 'classify-document') {
			return {
				receipt,
				structured: {
					rawKind: this.kind,
					resolvedKind: this.kind,
					family: this.kind === 'invoice' ? 'invoice-family' : 'statement-family',
					confidenceBps: 9900,
					reason: `The rendered page visibly contains a ${this.kind}.`,
					resolutionMode: 'model',
					alternatives: []
				}
			}
		}
		if (request.procedure === 'extract-statement') {
			return {
				receipt,
				structured: {
					candidate: {
						statementKind: 'monthly-statement',
						currency: 'EUR',
						accountHolder: 'Aven Test GmbH',
						accountHolderAddress: null,
						accountHolderDetails: null,
						institution: { name: 'Aven Test Bank', city: 'Berlin' },
						accountIban: 'DE02120300000000202051',
						accountBic: null,
						accountNumber: null,
						productName: 'Current account',
						openingBalanceMinor: 20_000,
						closingBalanceMinor: 8_100,
						periodStart: '2025-01-01',
						periodEnd: '2025-01-31',
						transactions: [
							{
								transactionId: 'TX-1',
								bookingDate: '2025-01-20',
								valueDate: '2025-01-20',
								title: 'SEPA transfer',
								amountMinor: -11_900,
								counterpartyName: 'Landwirtschaftliche Genossenschaft eG',
								counterpartyIban: null,
								description: 'DE-2025-00001',
								originalAmountMinor: null,
								originalCurrency: null,
								exchangeRate: null,
								fxSurchargeMinor: null,
								foreignExchangeFeeBps: null,
								balanceAfterMinor: 8_100,
								sourceRow: 1
							}
						],
						notes: null,
						summary: 'January account statement with one transaction.'
					},
					evidence: []
				}
			}
		}
		return {
			receipt,
			structured: {
				candidate: {
					supplier: 'Landwirtschaftliche Genossenschaft eG',
					invoiceNumber: 'DE-2025-00001',
					currency: 'EUR',
					netMinor: 10_000,
					taxMinor: 1_900,
					grossMinor: 11_900,
					dueDate: '2025-02-15',
					summary: 'Invoice DE-2025-00001 for EUR 119.00.'
				},
				details: {
					documentKind: 'invoice',
					category: 'goods',
					issueDate: '2025-01-16',
					customerNumber: null,
					orderNumber: null,
					supplier: {
						name: 'Landwirtschaftliche Genossenschaft eG',
						vatId: null,
						taxNumber: null,
						address: null,
						street: null,
						postalCode: null,
						city: null,
						country: 'Germany',
						email: null,
						phone: null,
						website: null,
						contactName: null,
						bankingAccounts: []
					},
					buyer: null,
					lineItems: [],
					taxBreakdown: [],
					payment: null,
					payments: [],
					referenceEntries: []
				},
				evidence: []
			}
		}
	}
}

class UnavailableModel extends GoldenInvoiceModel {
	override async status() {
		return { available: false, maxPages: 15 }
	}
}

class FailingModel extends GoldenInvoiceModel {
	override async complete(
		request: DocumentModelRequest
	): ReturnType<GoldenInvoiceModel['complete']> {
		this.requests.push(structuredClone(request))
		throw new Error('deterministic model failure')
	}
}

describe('document execution lane conformance', () => {
	test('proves the same safe fallback when vision is unavailable', async () => {
		const result = await modelParityRun(() => new UnavailableModel())
		expect(result.localModel.requests).toEqual([])
		expect(result.serverModel.requests).toEqual([])
		expect(result.record?.checkpoints.at(-1)?.output).toMatchObject({
			kind: 'artifact-understanding',
			status: 'partial',
			stoppingReason: 'needs_review'
		})
	})

	test('isolates failed model actors in both lanes without publishing invented finance facts', async () => {
		const source = {
			artifactId: SOURCE_ID,
			originalName: 'failing-model.jpg',
			declaredMediaType: 'image/jpeg',
			base64: bytesToBase64(imageGolden)
		}
		const localModel = new FailingModel()
		const localGateway = new RecordingGateway()
		const local = await new DocumentProcessingRuntime(
			createDocumentActors(new BrowserDocumentDecoder(), localModel),
			localGateway,
			() => localModel.status(),
			{ executionEnvironment: 'local', runtimeHost: 'desktop' }
		).start(source)
		expect(local.state).toBe('needs_review')
		expect(local.metadata.failedActorCount).toBe(2)
		expect(
			local.stages.filter((stage) => stage.state === 'failed').map((stage) => stage.key)
		).toEqual(['classify-document', 'analyze-page-001'])
		expect(localGateway.runs.some((run) => run.procedureKey.includes('extract-invoice'))).toBe(
			false
		)

		const serverModel = new FailingModel()
		const store = new FakeArtifactStore(source.originalName, source.declaredMediaType, imageGolden)
		const runner = new MemoryPlanRunner(
			createDocumentSkillExecutor({
				model: serverModel,
				artifactsFor: () => ({
					client: store as unknown as ArtifactStoreClient,
					scopeId: TENANT_ID,
					userId: SECURITY.principal.subjectId
				})
			})
		)
		const command = documentPlanRunCommand(
			documentRunStartRequest(
				{
					artifactId: SOURCE_ID,
					originalName: source.originalName,
					declaredMediaType: source.declaredMediaType
				},
				'server',
				crypto.randomUUID()
			)
		)
		const handle = await runner.start({ ...command, security: SECURITY })
		const completed = await waitForTerminalRun(runner, handle.runId)
		expect(completed.state).toBe('succeeded')
		expect(completed.failure).toBeUndefined()
		expect(completed.checkpoints.at(-1)?.output).toMatchObject({
			kind: 'artifact-understanding',
			status: 'partial',
			stoppingReason: 'needs_review',
			presentation: {
				state: 'needs_review',
				metadata: { failedActorCount: 2 },
				stages: expect.arrayContaining([
					expect.objectContaining({ key: 'classify-document', state: 'failed' }),
					expect.objectContaining({ key: 'analyze-page-001', state: 'failed' })
				])
			}
		})
		expect(
			store.publications.some((publication) =>
				String(record(publication.run).procedureKey).includes('extract-invoice')
			)
		).toBe(false)
		expect(serverModel.requests).toEqual(localModel.requests)
	}, 10_000)

	test('proves client/server parity for model-backed statement understanding', async () => {
		const result = await modelParityRun(() => new GoldenInvoiceModel('bank-statement'))
		expect(result.localModel.requests.map((request) => request.procedure)).toEqual([
			'classify-document',
			'analyze-page',
			'extract-statement'
		])
		expect(result.serverModel.requests).toEqual(result.localModel.requests)
		expect(result.record?.checkpoints.at(-1)?.output).toMatchObject({
			kind: 'artifact-understanding',
			facts: expect.arrayContaining([
				expect.objectContaining({
					predicate: 'ceo.aven.bookkeeping.statement_candidate',
					schema: 'ceo.aven:schema:bookkeeping:statement-candidate@2'
				})
			])
		})
	})

	test('proves client/server parity for model-backed image understanding', async () => {
		const source = {
			artifactId: SOURCE_ID,
			originalName: '0001_DE_agri_coop_de-2025-00001-k.jpg',
			declaredMediaType: 'image/jpeg',
			base64: bytesToBase64(imageGolden)
		}
		const localModel = new GoldenInvoiceModel()
		const localGateway = new RecordingGateway()
		const local = await new DocumentProcessingRuntime(
			createDocumentActors(new BrowserDocumentDecoder(), localModel),
			localGateway,
			() => localModel.status(),
			{ executionEnvironment: 'local', runtimeHost: 'desktop' }
		).start(source)

		const serverModel = new GoldenInvoiceModel()
		const store = new FakeArtifactStore(source.originalName, source.declaredMediaType, imageGolden)
		const execute = createDocumentSkillExecutor({
			model: serverModel,
			artifactsFor: () => ({
				client: store as unknown as ArtifactStoreClient,
				scopeId: TENANT_ID,
				userId: SECURITY.principal.subjectId
			})
		})
		const runner = new MemoryPlanRunner(execute)
		const command = documentRunStartRequest(
			{
				artifactId: SOURCE_ID,
				originalName: source.originalName,
				declaredMediaType: source.declaredMediaType
			},
			'server',
			crypto.randomUUID()
		)
		const handle = await runner.start({ ...documentPlan(command), security: SECURITY })
		await waitForRun(runner, handle.runId)
		const record = await runner.status(handle.runId)
		const server = record?.checkpoints.at(-1)?.output
			?.presentation as ArtifactProcessingPresentation

		expect(canonicalPresentation(server)).toEqual(canonicalPresentation(local))
		expect(canonicalServerRuns(store.publications)).toEqual(canonicalLocalRuns(localGateway.runs))
		expect(localModel.requests.map((request) => request.procedure)).toEqual([
			'classify-document',
			'analyze-page',
			'extract-invoice'
		])
		expect(serverModel.requests).toEqual(localModel.requests)
		expect(record?.checkpoints.at(-1)?.output).toMatchObject({
			kind: 'artifact-understanding',
			status: 'complete',
			stoppingReason: 'saturated',
			subjectArtifactId: SOURCE_ID,
			facts: expect.arrayContaining([
				expect.objectContaining({
					predicate: 'ceo.aven.bookkeeping.invoice_details',
					schema: 'ceo.aven:schema:bookkeeping:invoice-details@2'
				})
			])
		})
	})

	for (const golden of GOLDEN_DOCUMENTS) {
		test(`produces the same canonical graph for ${golden.name} locally and on the runner`, async () => {
			const source = {
				artifactId: SOURCE_ID,
				originalName: golden.name,
				declaredMediaType: golden.mediaType,
				base64: bytesToBase64(golden.bytes)
			}
			const localGateway = new RecordingGateway()
			const local = await new DocumentProcessingRuntime(
				createDocumentActors(new BrowserDocumentDecoder()),
				localGateway,
				undefined,
				{ executionEnvironment: 'local', runtimeHost: 'desktop' }
			).start(source)

			const store = new FakeArtifactStore(golden.name, golden.mediaType, golden.bytes)
			const execute = createDocumentSkillExecutor({
				artifactsFor: () => ({
					client: store as unknown as ArtifactStoreClient,
					scopeId: TENANT_ID,
					userId: SECURITY.principal.subjectId
				})
			})
			const runner = new MemoryPlanRunner(execute)
			const client: PlanRunnerClient = {
				start: (command: PlanRunStartCommand) => runner.start({ ...command, security: SECURITY }),
				status: (runId) => runner.status(runId),
				resume: (runId, submission) => runner.resume(runId, submission),
				cancel: (runId, requestId) => runner.cancel(runId, requestId)
			}
			const remote = new RemoteDocumentExecutionHost(client, 1, 5_000)
			const server = await remote.start(
				documentRunStartRequest(
					{
						artifactId: SOURCE_ID,
						originalName: golden.name,
						declaredMediaType: golden.mediaType
					},
					'server',
					crypto.randomUUID()
				)
			)

			expect(canonicalPresentation(server)).toEqual(canonicalPresentation(local))
			expect(server.metadata).toMatchObject({
				executionEnvironment: 'server',
				runtimeHost: 'actor-runner'
			})
			expect(canonicalServerRuns(store.publications)).toEqual(canonicalLocalRuns(localGateway.runs))
			expect(
				store.publications.every(
					(publication) => record(publication.run).implementation && publication.kind === 'run'
				)
			).toBe(true)
		})
	}
})

function documentPlan(request: ReturnType<typeof documentRunStartRequest>) {
	return documentPlanRunCommand(request)
}

async function waitForRun(runner: MemoryPlanRunner, runId: string) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const record = await runner.status(runId)
		if (record?.state === 'succeeded') return
		if (record?.state === 'failed') throw new Error(record.failure?.message)
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error('run did not finish')
}

async function waitForTerminalRun(runner: MemoryPlanRunner, runId: string) {
	for (let attempt = 0; attempt < 5_000; attempt += 1) {
		const record = await runner.status(runId)
		if (record && ['succeeded', 'failed', 'cancelled'].includes(record.state)) return record
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error('run did not finish')
}

async function modelParityRun(model: () => GoldenInvoiceModel) {
	const source = {
		artifactId: SOURCE_ID,
		originalName: 'model-backed-golden.jpg',
		declaredMediaType: 'image/jpeg',
		base64: bytesToBase64(imageGolden)
	}
	const localModel = model()
	const localGateway = new RecordingGateway()
	const local = await new DocumentProcessingRuntime(
		createDocumentActors(new BrowserDocumentDecoder(), localModel),
		localGateway,
		() => localModel.status(),
		{ executionEnvironment: 'local', runtimeHost: 'desktop' }
	).start(source)
	const serverModel = model()
	const store = new FakeArtifactStore(source.originalName, source.declaredMediaType, imageGolden)
	const runner = new MemoryPlanRunner(
		createDocumentSkillExecutor({
			model: serverModel,
			artifactsFor: () => ({
				client: store as unknown as ArtifactStoreClient,
				scopeId: TENANT_ID,
				userId: SECURITY.principal.subjectId
			})
		})
	)
	const command = documentPlanRunCommand(
		documentRunStartRequest(
			{
				artifactId: SOURCE_ID,
				originalName: source.originalName,
				declaredMediaType: source.declaredMediaType
			},
			'server',
			crypto.randomUUID()
		)
	)
	const handle = await runner.start({ ...command, security: SECURITY })
	await waitForRun(runner, handle.runId)
	const record = await runner.status(handle.runId)
	const server = record?.checkpoints.at(-1)?.output?.presentation as ArtifactProcessingPresentation
	expect(canonicalPresentation(server)).toEqual(canonicalPresentation(local))
	expect(canonicalServerRuns(store.publications)).toEqual(canonicalLocalRuns(localGateway.runs))
	return { localModel, serverModel, record }
}

function canonicalPresentation(presentation: ArtifactProcessingPresentation) {
	return {
		state: presentation.state,
		preferredType: presentation.preferredType,
		summary: presentation.summary,
		warnings: presentation.warnings,
		stages: presentation.stages,
		derivedTypes: presentation.derivedArtifacts.map((artifact) => ({
			typeKey: artifact.typeKey,
			typeVersion: artifact.typeVersion,
			stageKey: artifact.stageKey
		})),
		metadata: Object.fromEntries(
			Object.entries(presentation.metadata).filter(
				([key]) => !['executionEnvironment', 'runtimeHost'].includes(key)
			)
		)
	}
}

function canonicalLocalRuns(runs: ClientRunPublication[]) {
	return runs.map((run) => ({
		procedureKey: run.procedureKey,
		inputs: run.inputs.map(({ role, ordinal }) => ({ role, ordinal })),
		parameters: run.parameters,
		artifacts: run.artifacts.map((artifact) => ({
			...artifact,
			...(artifact.blob && {
				blob: {
					mediaType: artifact.blob.mediaType,
					length: Buffer.from(artifact.blob.base64, 'base64').length,
					sha256: createHash('sha256')
						.update(Buffer.from(artifact.blob.base64, 'base64'))
						.digest('hex')
				}
			})
		})),
		evidence: run.evidence
	}))
}

function canonicalServerRuns(publications: Array<Record<string, unknown>>) {
	return publications.map((publication) => {
		const run = record(publication.run)
		return {
			procedureKey: run.procedureKey,
			inputs: array(run.inputs).map((value) => {
				const input = record(value)
				return { role: input.role, ordinal: input.ordinal }
			}),
			parameters: run.parameters,
			artifacts: array(publication.artifacts).map((value) => {
				const artifact = record(value)
				const blob = artifact.blob
				return {
					localKey: artifact.localKey,
					typeKey: artifact.typeKey,
					typeVersion: artifact.typeVersion,
					payload: artifact.payload,
					output: artifact.output,
					...(blob
						? {
								blob: {
									mediaType: 'text/plain; charset=utf-8',
									length: record(blob).length,
									sha256: record(blob).sha256
								}
							}
						: {})
				}
			}),
			evidence: publication.evidence
		}
	})
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('object expected')
	return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('array expected')
	return value
}

function uuid(ordinal: number): string {
	return `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`
}

function bytesToBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64')
}
