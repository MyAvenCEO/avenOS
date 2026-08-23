const scopeId = process.env.ARTIFACT_STORE_SCOPE_ID ?? '11111111-1111-4111-8111-111111111111'
const databaseName = process.env.ARTIFACT_STORE_DATABASE_NAME ?? 'cust_artifact_local'
const storeToken =
	process.env.ARTIFACT_STORE_BEARER_TOKEN ?? 'artifact-local-coordinator-token-0001'
const storeUrl = (
	process.env.ARTIFACT_STORE_BASE_URL ??
	`http://127.0.0.1:${process.env.ARTIFACT_STORE_PORT ?? '8087'}`
).replace(/\/$/, '')
const processorToken =
	process.env.ARTIFACT_PROCESSOR_BEARER_TOKEN ?? 'processor-local-status-token-0001'
const processorUrl = (
	process.env.ARTIFACT_PROCESSOR_BASE_URL ??
	`http://127.0.0.1:${process.env.ARTIFACT_PROCESSOR_PORT ?? '8089'}`
).replace(/\/$/, '')
const expectFailure = process.env.ARTIFACT_PROCESSING_SMOKE_CASE === 'invalid'

async function storeRequest(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('authorization', `Bearer ${storeToken}`)
	headers.set('x-aven-artifact-database', databaseName)
	const response = await fetch(`${storeUrl}${path}`, { ...init, headers })
	if (response.ok) return response
	throw new Error(
		`${init.method ?? 'GET'} ${path} failed (${response.status}): ${await response.text()}`
	)
}

async function storeJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	return (await (await storeRequest(path, init)).json()) as Record<string, unknown>
}

const fixture = {
	title: 'Mock ACME invoice with product photo',
	documentKind: 'invoice',
	pages: [
		{
			facets: expectFailure ? ['execute-macro'] : ['native-text', 'table'],
			text: 'ACME GmbH\nInvoice INV-2026-0815\nNet 100.00 EUR\nTax 19.00 EUR',
			visualSummary: ''
		},
		{
			facets: ['native-text', 'photograph'],
			text: 'Gross 119.00 EUR\nDue 2026-09-30',
			visualSummary: 'A product photograph appears beside the payment total.'
		}
	],
	invoice: {
		supplier: 'ACME GmbH',
		invoiceNumber: 'INV-2026-0815',
		currency: 'EUR',
		netMinor: 10_000,
		taxMinor: 1_900,
		grossMinor: 11_900,
		dueDate: '2026-09-30'
	}
}
const bytes = new TextEncoder().encode(JSON.stringify(fixture))
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
	.map((byte) => byte.toString(16).padStart(2, '0'))
	.join('')
const context = await storeJson('/v1/context')
const storeEpoch = context.storeEpoch
if (typeof storeEpoch !== 'string') throw new Error('Store context has no epoch')
const claimId = crypto.randomUUID()
const publicationId = crypto.randomUUID()

await storeRequest(`/v1/scopes/${scopeId}/uploads/${claimId}`, {
	method: 'PUT',
	headers: {
		'content-length': String(bytes.byteLength),
		'content-type': 'application/x-aven-mock-document+json',
		'x-expected-sha256': sha256
	},
	body: bytes
})
const publication = await storeJson(`/v1/scopes/${scopeId}/publications/${publicationId}`, {
	method: 'PUT',
	headers: {
		'content-type': 'application/json',
		'if-artifact-store-epoch': storeEpoch
	},
	body: JSON.stringify({
		intent: {
			commandVersion: 1,
			publicationId,
			scopeId,
			kind: 'roots',
			rootActor: { kind: 'service', id: 'service:artifact-processing-smoke' },
			artifacts: [
				{
					localKey: 'file',
					typeKey: 'core.file',
					typeVersion: 1,
					payload: {
						originalName: 'mock-acme-invoice.pdf',
						declaredMediaType: 'application/pdf',
						sourceKind: 'processing-mock'
					},
					blob: { sha256, length: bytes.byteLength },
					references: [],
					output: null
				}
			],
			evidence: []
		},
		blobAuthorities: { file: { kind: 'upload-claim', claimId } }
	})
})
const artifacts = publication.artifacts
if (!Array.isArray(artifacts) || artifacts.length !== 1)
	throw new Error('Source publication failed')
const artifactId = (artifacts[0] as Record<string, unknown>).artifactId
if (typeof artifactId !== 'string') throw new Error('Source artifact id is missing')

let status: Record<string, unknown> | undefined
const deadline = Date.now() + 30_000
while (Date.now() < deadline) {
	let response: Response
	try {
		response = await fetch(
			`${processorUrl}/v1/scopes/${scopeId}/artifacts/${artifactId}/processing`,
			{ headers: { authorization: `Bearer ${processorToken}` } }
		)
	} catch {
		await Bun.sleep(200)
		continue
	}
	if (response.ok) {
		status = (await response.json()) as Record<string, unknown>
		if (status.state === 'succeeded' || status.state === 'failed') break
	} else if (response.status !== 404) {
		throw new Error(`Processing status failed (${response.status}): ${await response.text()}`)
	}
	await Bun.sleep(200)
}
if (!status) throw new Error('Processor did not discover the mock artifact')
if (expectFailure) {
	if (status.state !== 'failed') throw new Error(`Invalid fixture ended in ${String(status.state)}`)
	if (status.preferredType !== 'file') {
		throw new Error(
			`Failed fixture did not retain file presentation: ${String(status.preferredType)}`
		)
	}
	if (!Array.isArray(status.warnings) || status.warnings.length === 0) {
		throw new Error('Failed fixture did not expose a processing warning')
	}
	console.log(
		JSON.stringify(
			{
				status: 'expected-error',
				artifactId,
				caseId: status.caseId,
				preferredType: status.preferredType,
				warnings: status.warnings
			},
			null,
			2
		)
	)
	process.exit(0)
}
if (status.state !== 'succeeded') throw new Error(`Processing ended in ${String(status.state)}`)
if (status.preferredType !== 'invoice') {
	throw new Error(`Expected preferredType invoice, got ${String(status.preferredType)}`)
}
if (status.summary !== 'Invoice INV-2026-0815 from ACME GmbH for 11900 EUR minor units.') {
	throw new Error(`Unexpected summary: ${String(status.summary)}`)
}
if (!Array.isArray(status.warnings) || status.warnings.length !== 0) {
	throw new Error('Consistent fixture unexpectedly produced warnings')
}
const stages = status.stages
if (
	!Array.isArray(stages) ||
	stages.length !== 12 ||
	stages.some((stage) => stage.state !== 'succeeded')
) {
	throw new Error(`Expected 12 succeeded stages, got ${JSON.stringify(stages)}`)
}
const derived = status.derivedArtifacts
if (!Array.isArray(derived)) throw new Error('Derived artifacts are missing')
const types = new Set(derived.map((artifact) => artifact.typeKey))
for (const required of [
	'docs.page',
	'core.content-description',
	'docs.extracted-text',
	'docs.text-layout',
	'core.document-classification',
	'bookkeeping.invoice-candidate',
	'bookkeeping.invoice-validation'
]) {
	if (!types.has(required)) throw new Error(`Derived type ${required} is missing`)
}

console.log(
	JSON.stringify(
		{
			status: 'ok',
			artifactId,
			caseId: status.caseId,
			preferredType: status.preferredType,
			stages: stages.length,
			derivedArtifacts: derived.length
		},
		null,
		2
	)
)
