import { expect, test } from 'vitest'
import {
	ArtifactFileService,
	type PublishClientRunInput
} from '../src/lib/server/artifacts/service'

const id = '11111111-1111-4111-8111-111111111111'
function body(): PublishClientRunInput {
	return {
		userId: id,
		databaseName: 'cust_test',
		scopeId: id,
		publicationId: id,
		procedureKey: 'client.extract-native-text',
		procedureVersion: 'client-v1',
		inputs: [
			{ role: 'source', ordinal: 0, artifactId: id },
			{ role: 'page', ordinal: 0, artifactId: id }
		],
		parameters: { page: 1 },
		artifacts: [
			{
				localKey: 'text',
				typeKey: 'docs.extracted-text',
				typeVersion: 2,
				payload: {
					method: 'native',
					language: 'und',
					pageCount: 1,
					characterCount: 5,
					complete: true
				},
				output: { role: 'text', ordinal: 0 },
				blob: { mediaType: 'text/plain; charset=utf-8', base64: 'aGVsbG8=' }
			},
			{
				localKey: 'layout',
				typeKey: 'docs.text-layout',
				typeVersion: 2,
				payload: { coordinateSpace: 'normalized-millionths', spans: [], complete: true },
				output: { role: 'layout', ordinal: 0 }
			}
		],
		evidence: []
	}
}
const config = {
	ARTIFACT_STORE_BASE_URL: 'http://store.test',
	ARTIFACT_STORE_BEARER_TOKEN: 'fixture'
}
function invoiceValidation(current: boolean): PublishClientRunInput {
	return {
		...body(),
		procedureKey: 'client.validate-invoice',
		inputs: [
			{ role: 'source', ordinal: 0, artifactId: id },
			{ role: 'candidate', ordinal: 0, artifactId: id },
			...(current ? [{ role: 'details', ordinal: 0, artifactId: id }] : [])
		],
		parameters: current ? { rulesetVersion: 'invoice-core-v2' } : {},
		artifacts: [
			{
				localKey: 'validation',
				typeKey: 'bookkeeping.invoice-validation',
				typeVersion: 1,
				payload: {
					rulesetVersion: current ? 'invoice-core-v2' : 'invoice-core-v1',
					status: 'consistent',
					coverageBps: 10000,
					checks: []
				},
				output: { role: 'validation', ordinal: 0 }
			}
		]
	}
}

test('current invoice validation with details reaches the store', async () => {
	let requests = 0
	const service = ArtifactFileService.fromConfig(config, async () => {
		requests++
		return Response.json({ code: 'STORE_PROBE', detail: 'contract accepted' }, { status: 422 })
	})!
	await expect(service.publishClientRun(invoiceValidation(true))).rejects.toMatchObject({
		status: 422,
		code: 'STORE_PROBE'
	})
	expect(requests).toBe(1)
})

test('invoice validation cannot claim v2 without its details and matching ruleset parameters', async () => {
	let requests = 0
	const service = ArtifactFileService.fromConfig(config, async () => {
		requests++
		throw new Error('must not contact store')
	})!
	const current = invoiceValidation(true)
	const legacy = invoiceValidation(false)
	const invalidInputs: PublishClientRunInput[] = [
		legacy,
		{ ...current, inputs: legacy.inputs },
		{ ...current, parameters: {} },
		{ ...current, parameters: { rulesetVersion: 'invoice-core-v3' } },
		{ ...current, parameters: { rulesetVersion: 'invoice-core-v2', extra: true } },
		{ ...current, artifacts: legacy.artifacts },
		{ ...legacy, artifacts: current.artifacts },
		{ ...legacy, inputs: current.inputs }
	]
	for (const input of invalidInputs) {
		await expect(service.publishClientRun(input)).rejects.toMatchObject({
			status: 400,
			code: 'CLIENT_PROCEDURE_CONTRACT_INVALID'
		})
	}
	expect(requests).toBe(0)
})

test('missing arrays, malformed drafts and fractional artifact JSON fail before contacting the store', async () => {
	let requests = 0
	const service = ArtifactFileService.fromConfig(config, async () => {
		requests++
		throw new Error('must not contact store')
	})!
	for (const input of [
		{ ...body(), inputs: undefined },
		{ ...body(), artifacts: [null] },
		{ ...body(), parameters: { cost: 0.01 } },
		{ ...body(), publicationId: undefined }
	]) {
		await expect(
			service.publishClientRun(input as unknown as PublishClientRunInput)
		).rejects.toMatchObject({ status: 400, code: 'CLIENT_RUN_INVALID' })
	}
	expect(requests).toBe(0)
})
for (const [status, code] of [
	[422, 'INVALID_EVIDENCE'],
	[429, 'STAGING_QUOTA_EXCEEDED'],
	[503, 'STORE_RECONCILIATION_REQUIRED']
] as const)
	test(`preserves store ${status} ${code}`, async () => {
		const service = ArtifactFileService.fromConfig(config, async () =>
			Response.json({ code, detail: 'fixture rejection' }, { status })
		)!
		await expect(service.publishClientRun(body())).rejects.toMatchObject({
			status,
			code,
			message: 'fixture rejection'
		})
	})

function preservedText(): PublishClientRunInput {
	const input = body()
	input.procedureKey = 'client.preserve-text-page'
	input.inputs.push(
		{ role: 'text', ordinal: 0, artifactId: id },
		{ role: 'layout', ordinal: 0, artifactId: id }
	)
	input.artifacts.push({
		localKey: 'classification',
		typeKey: 'core.content-classification',
		typeVersion: 1,
		payload: {
			subjectLevel: 'page',
			primaryKind: 'text',
			facets: ['native-text'],
			confidenceBps: 10000,
			reason: 'Native text',
			resolutionMode: 'rule',
			complete: true
		},
		output: { role: 'classification', ordinal: 0 }
	})
	return input
}

test('preserved native text reaches storage without a model receipt', async () => {
	let requests = 0
	const service = ArtifactFileService.fromConfig(config, async () => {
		requests++
		return Response.json({ code: 'STORE_PROBE', detail: 'contract accepted' }, { status: 422 })
	})!
	await expect(service.publishClientRun(preservedText())).rejects.toMatchObject({
		status: 422,
		code: 'STORE_PROBE'
	})
	expect(requests).toBe(1)
})

test('text preservation cannot claim OCR, model authority, or omit native provenance', async () => {
	let requests = 0
	const service = ArtifactFileService.fromConfig(config, async () => {
		requests++
		throw new Error('must not contact store')
	})!
	const ocr = preservedText()
	ocr.artifacts[0]!.payload = { ...(ocr.artifacts[0]!.payload as object), method: 'ocr' }
	const model = preservedText()
	model.artifacts[2]!.payload = {
		...(model.artifacts[2]!.payload as object),
		resolutionMode: 'model'
	}
	const missing = preservedText()
	missing.inputs = missing.inputs.filter((input) => input.role !== 'text')
	for (const input of [
		ocr,
		model,
		missing,
		{ ...preservedText(), parameters: { page: 1, modelReceipt: {} } }
	])
		await expect(service.publishClientRun(input)).rejects.toMatchObject({
			status: 400,
			code: 'CLIENT_PROCEDURE_CONTRACT_INVALID'
		})
	expect(requests).toBe(0)
})
