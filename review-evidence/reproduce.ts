// Review probes: assert observed defects/fixes without changing production code.

import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createActorPlanExecutor, MessageBus } from '../libs/aven-actors/src/index'
import { loadImage } from '../libs/aven-document-ingest/node_modules/@napi-rs/canvas'
import {
	createDocumentActors,
	createInvoiceValidatorActor,
	normalizeInvoiceOpenItem
} from '../libs/aven-document-ingest/src/actors'
import {
	documentPlanRunCommand,
	documentRunStartRequest,
	RemoteDocumentExecutionHost
} from '../libs/aven-document-ingest/src/execution'
import { DocumentProcessingRuntime } from '../libs/aven-document-ingest/src/runtime'
import { ServerDocumentDecoder } from '../libs/aven-document-ingest/src/server'
import { createApplicationExecutor } from '../services/actor-runner/src/application-executor'
import { createServerActorExecutionHost } from '../services/actor-runner/src/host'
import { MemoryPlanRunner } from '../services/actor-runner/src/memory-runner'
import { GoldenInvoiceModel } from '../services/actor-runner/tests/support/golden-document-model'
import { ArtifactFileService } from '../services/aven-api/src/lib/server/artifacts/service'

// JPEG-only browser probe: its unused browser PDF worker URL needs a Vite loader.
mock.module('../app/src/lib/artifacts/pdf', () => ({
	base64ToBytes: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
	loadOwnedPdf: () => {
		throw new Error('PDF loader intentionally unavailable in JPEG probe')
	}
}))
const { BrowserDocumentDecoder } = await import('../app/src/lib/artifacts/browser-document-decoder')

const id = '11111111-1111-4111-8111-111111111111'
const security = {
	principal: { subjectId: id, kind: 'user', assurance: ['passkey'] },
	access: { tenantId: id },
	establishedBy: 'review',
	authorizedAt: new Date().toISOString()
}
const source = { artifactId: id, originalName: 'invoice.pdf', declaredMediaType: 'application/pdf' }
const command = (s = source) => ({
	...documentPlanRunCommand(documentRunStartRequest(s, 'server')),
	security
})
const first = command()
const restored = command({ artifactId: id, originalName: 'invoice.pdf' } as typeof source)
const runner = new MemoryPlanRunner(async () => ({
	artifactIds: [],
	completedStepIds: [],
	remainingGoals: []
}))
await runner.start(first as any)
assert.equal(first.idempotencyKey, restored.idempotencyKey)
await assert.rejects(runner.start(restored as any), /idempotency key/)
console.log('F-2 CONFIRMED: upload/restart use the same key with conflicting source parameters.')

const remote = new RemoteDocumentExecutionHost({
	start: async () => {
		throw new Error('start refused')
	}
} as any)
await assert.rejects(remote.start(documentRunStartRequest(source, 'server')))
assert.equal(remote.status(id), undefined)
console.log('F-5 CONFIRMED: rejected start leaves no presentation.')

let executions = 0
const failing = new MemoryPlanRunner(async () => {
	executions++
	throw new Error('temporary outage')
})
const failed = await failing.start(first as any)
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal((await failing.status(failed.runId))?.state, 'failed')
const retry = await failing.start(first as any)
assert.equal(retry.runId, failed.runId)
assert.equal(executions, 1)
console.log('F-12 CONFIRMED: identical retry returns failed run without executing again.')

const fallback = createApplicationExecutor(
	[],
	createActorPlanExecutor(createServerActorExecutionHost())
)
const unknown = await fallback({ ...first, skillRef: first.skillRef.replace('@1', '@2') } as any)
console.log('F-13 unknown exploration result:', JSON.stringify(unknown))
assert.equal(unknown.completedStepIds.length, 0)

const jpeg = await readFile(new URL('../fixtures/artifacts/IM_00140.JPG', import.meta.url))
const decoded = await new ServerDocumentDecoder().decode(
	{
		artifactId: id,
		originalName: 'photo.jpg',
		declaredMediaType: 'image/jpeg',
		base64: jpeg.toString('base64')
	},
	{ modelPageLimit: 1 }
)
const visual = Buffer.from(decoded.pages[0]?.image?.base64, 'base64')
const original = await loadImage(jpeg)
await assert.rejects(loadImage(visual))
console.log(
	`F-3 CONFIRMED: ${jpeg.length} -> ${visual.length} bytes; original ${original.width}x${original.height}, emitted image does not decode.`
)
const browserDecoded = await new BrowserDocumentDecoder().decode(
	{
		artifactId: id,
		originalName: 'photo.jpg',
		declaredMediaType: 'image/jpeg',
		base64: jpeg.toString('base64')
	},
	{ modelPageLimit: 1 }
)
assert.equal(Buffer.from(browserDecoded.pages[0]?.image?.base64, 'base64').length, 4824)
console.log('F-3 browser adapter independently emits the same truncated 4824 bytes.')

const paid = normalizeInvoiceOpenItem(
	{ supplier: 'Shop', invoiceNumber: 'R-1', currency: 'EUR', grossMinor: 11900, summary: 'paid' },
	{ supplier: null, payment: { totalOutstandingMinor: 0, amountPaidMinor: 11900 } },
	{ status: 'consistent' }
)
assert.equal(paid.amountDueMinor, 11900)
assert.throws(() =>
	normalizeInvoiceOpenItem(
		{ supplier: 'Shop', invoiceNumber: 'R-1', currency: null, grossMinor: 11900 },
		{ supplier: null },
		{}
	)
)
console.log(
	'F-17 CONFIRMED in part: zero outstanding becomes 11900 due; missing currency is now rejected.'
)

const bus = new MessageBus()
const validator = createInvoiceValidatorActor()
bus.register(validator)
const validation = await bus.dispatch('review', 'document_validate_invoice', {
	candidate: {
		supplier: 'Shop',
		invoiceNumber: 'R-1',
		netMinor: 10000,
		taxMinor: 1900,
		grossMinor: 190000
	}
})
console.log('F-9 arithmetic result:', validation.record)
assert.equal(validator.handles('toString'), true)

const publications: any[] = []
const service = ArtifactFileService.fromConfig(
	{ ARTIFACT_STORE_BASE_URL: 'http://store.test', ARTIFACT_STORE_BEARER_TOKEN: 'test' },
	async (input, init) => {
		const request = new Request(input, init)
		if (request.url.endsWith('/context')) return Response.json({ storeEpoch: 'epoch' })
		if (request.url.includes('/uploads/'))
			return Response.json({
				length: Number(request.headers.get('content-length')),
				sha256: request.headers.get('x-expected-sha256')
			})
		if (request.url.includes('/artifacts/'))
			return Response.json({ typeKey: 'core.file', payload: source })
		if (request.url.includes('/publications/')) {
			const body = (await request.json()) as any
			publications.push(body)
			return Response.json({
				publicationId: body.intent.publicationId,
				runId: crypto.randomUUID(),
				replayed: false,
				scopeSequence: publications.length,
				artifacts: body.intent.artifacts.map((a: any) => ({
					localKey: a.localKey,
					artifactId: crypto.randomUUID()
				}))
			})
		}
		throw new Error(`Unexpected URL ${request.url}`)
	}
)!
try {
	await service.publishClientRun({
		procedureKey: 'client.extract-native-text',
		procedureVersion: 'client-v1',
		parameters: { page: 1 },
		artifacts: [],
		evidence: []
	} as any)
	assert.fail('missing inputs should fail')
} catch (error: any) {
	assert.equal(error.status, 502)
	console.log(`F-10 CONFIRMED: missing inputs -> ${error.status} ${error.code}`)
}

const image = await readFile(
	new URL('../fixtures/artifacts/0001_DE_agri_coop_de-2025-00001-k.jpg', import.meta.url)
)
const imageSource = {
	artifactId: id,
	originalName: 'receipt.jpg',
	declaredMediaType: 'image/jpeg',
	base64: image.toString('base64')
}
for (const mode of [
	'invoice',
	'bank-statement',
	'page-failure',
	'classification-failure',
	'deterministic'
] as const) {
	const model = new GoldenInvoiceModel(mode === 'bank-statement' ? mode : 'invoice')
	const originalComplete = model.complete.bind(model)
	model.complete = async (request) => {
		if (
			(mode === 'page-failure' && request.procedure === 'analyze-page') ||
			(mode === 'classification-failure' && request.procedure === 'classify-document')
		)
			throw new Error('review injected failure')
		return originalComplete(request)
	}
	const accepted: any[] = []
	const gateway = {
		publish: async (run: any) => {
			const receipt = await service.publishClientRun({
				...run,
				userId: id,
				databaseName: 'cust_review',
				scopeId: id
			})
			accepted.push(run)
			return receipt
		}
	}
	const runtime = new DocumentProcessingRuntime(
		createDocumentActors(new ServerDocumentDecoder(), mode === 'deterministic' ? undefined : model),
		gateway,
		mode === 'deterministic' ? undefined : () => model.status()
	)
	const result = await runtime.start(
		mode === 'deterministic'
			? {
					...imageSource,
					originalName: 'note.txt',
					declaredMediaType: 'text/plain',
					base64: Buffer.from('hello world').toString('base64')
				}
			: imageSource
	)
	console.log(
		`Contract probe ${mode}: ${result.state}; ${accepted.length} publications; ${result.summary}`
	)
	assert.notEqual(result.state, 'failed')
	if (mode === 'page-failure') {
		const run = accepted.find((r) => r.procedureKey === 'client.classify-page-signals')
		assert.deepEqual(
			run.inputs.map((i: any) => i.role),
			['source', 'page', 'text']
		)
		assert.deepEqual(run.parameters, { page: 1 })
	}
}
console.log(
	'F-4 FIX VERIFIED: current fallback passes the real facade validator. All five contract paths pass.'
)

const fractionalUsageModel = new GoldenInvoiceModel()
const completion = fractionalUsageModel.complete.bind(fractionalUsageModel)
fractionalUsageModel.complete = async (request) => {
	const result = await completion(request)
	return { ...result, receipt: { ...result.receipt, usage: { cost: 0.01 } } }
}
const publicationGateway = {
	publish: (run: any) =>
		service.publishClientRun({ ...run, userId: id, databaseName: 'cust_review', scopeId: id })
}
const floatRuntime = new DocumentProcessingRuntime(
	createDocumentActors(new ServerDocumentDecoder(), fractionalUsageModel),
	publicationGateway,
	() => fractionalUsageModel.status()
)
const floatResult = await floatRuntime.start(imageSource)
assert.equal(floatResult.state, 'failed')
assert.equal(floatResult.summary, 'Artifact Store is unavailable.')
console.log(
	'F-10 CONFIRMED: fractional provider usage causes publication failure reported as store unavailable.'
)

const bigImage = Buffer.alloc(7 * 1024 * 1024).toString('base64')
const syntheticDecoder = {
	decode: async () => ({
		outcome: 'ok' as const,
		detectedMediaType: 'application/pdf',
		encrypted: false,
		pages: [1, 2, 3].map((page) => ({
			page,
			rotation: 0 as const,
			width: 1000,
			height: 1000,
			runs: [],
			image: { mediaType: 'image/png' as const, base64: bigImage }
		}))
	})
}
const boundedModel = new GoldenInvoiceModel()
const bigRuntime = new DocumentProcessingRuntime(
	createDocumentActors(syntheticDecoder, boundedModel),
	publicationGateway,
	() => boundedModel.status()
)
const bigResult = await bigRuntime.start({ ...source, base64: '' })
assert.equal(bigResult.state, 'failed')
assert.equal(bigResult.summary, 'Client run blobs exceed their procedure limit.')
console.log(
	'F-8 current earlier bound CONFIRMED: synthetic 3 x 7 MiB rendered images exceed the 25 MiB decoded-inspection blob limit before any model call.'
)
