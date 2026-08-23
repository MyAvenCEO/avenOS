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

function minimalPdf(): Uint8Array {
	const stream = 'BT /F1 14 Tf 72 720 Td (Aven native PDF invoice example) Tj ET\n'
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${new TextEncoder().encode(stream).byteLength} >>\nstream\n${stream}endstream`
	]
	let pdf = '%PDF-1.4\n'
	const offsets = [0]
	for (const [index, object] of objects.entries()) {
		offsets.push(new TextEncoder().encode(pdf).byteLength)
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
	}
	const xref = new TextEncoder().encode(pdf).byteLength
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(pdf)
}

const format = process.env.ARTIFACT_PROCESSING_REAL_FORMAT ?? 'png'
const bytes =
	format === 'pdf'
		? minimalPdf()
		: format === 'unsupported'
			? new TextEncoder().encode('This file type is intentionally unsupported.')
			: new Uint8Array(await Bun.file('static/email/aven-logo.png').arrayBuffer())
if (bytes.byteLength < 24) throw new Error('Real fixture is missing or malformed')
const actualMediaType =
	format === 'pdf' ? 'application/pdf' : format === 'unsupported' ? 'text/plain' : 'image/png'
const declaredMediaType = format === 'pdf' ? 'image/png' : 'application/pdf'
const expectedPreferredType =
	format === 'pdf' ? 'document' : format === 'unsupported' ? 'application/octet-stream' : 'image'
const expectedState = format === 'unsupported' ? 'needs_review' : 'succeeded'
const expectedStages = format === 'unsupported' ? 1 : 6
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
		'content-type': actualMediaType,
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
			rootActor: { kind: 'service', id: 'service:artifact-processing-real-smoke' },
			artifacts: [
				{
					localKey: 'file',
					typeKey: 'core.file',
					typeVersion: 1,
					payload: {
						originalName: `real-${publicationId}.${format}`,
						declaredMediaType,
						sourceKind: 'desktop-drop'
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
if (!Array.isArray(artifacts) || artifacts.length !== 1) {
	throw new Error('Source publication failed')
}
const artifactId = (artifacts[0] as Record<string, unknown>).artifactId
if (typeof artifactId !== 'string') throw new Error('Source artifact id is missing')

let status: Record<string, unknown> | undefined
const deadline = Date.now() + 30_000
while (Date.now() < deadline) {
	const response = await fetch(
		`${processorUrl}/v1/scopes/${scopeId}/artifacts/${artifactId}/processing`,
		{ headers: { authorization: `Bearer ${processorToken}` } }
	)
	if (response.ok) {
		status = (await response.json()) as Record<string, unknown>
		if (['succeeded', 'failed', 'needs_review'].includes(String(status.state))) break
	} else if (response.status !== 404) {
		throw new Error(`Processing status failed (${response.status}): ${await response.text()}`)
	}
	await Bun.sleep(200)
}

if (!status) throw new Error('Processor did not discover the real artifact')
if (status.state !== expectedState) {
	throw new Error(
		`Real fixture ended in ${String(status.state)}: ${JSON.stringify(status.warnings)}`
	)
}
if (status.preferredType !== expectedPreferredType) {
	throw new Error(
		`Magic-byte inspection resolved ${String(status.preferredType)}, expected ${expectedPreferredType}`
	)
}
const stages = status.stages
if (
	!Array.isArray(stages) ||
	stages.length !== expectedStages ||
	stages.some((stage) => stage.state !== 'succeeded')
) {
	throw new Error(`Unexpected real stages: ${JSON.stringify(stages)}`)
}
const derived = status.derivedArtifacts
if (!Array.isArray(derived)) throw new Error('Derived artifacts are missing')
const types = new Set(derived.map((artifact) => artifact.typeKey))
const requiredTypes =
	format === 'unsupported'
		? ['core.file-inspection']
		: [
				'core.file-inspection',
				'docs.page',
				'docs.extracted-text',
				'docs.text-layout',
				'core.content-classification'
			]
for (const required of requiredTypes) {
	if (!types.has(required)) throw new Error(`Derived type ${required} is missing`)
}
if (format === 'unsupported' && (!Array.isArray(status.warnings) || status.warnings.length === 0)) {
	throw new Error('Unsupported file reached review without a warning')
}

console.log(
	JSON.stringify(
		{
			status: 'ok',
			artifactId,
			caseId: status.caseId,
			preferredType: status.preferredType,
			state: status.state,
			format,
			stages: stages.length,
			derivedArtifacts: derived.length
		},
		null,
		2
	)
)
