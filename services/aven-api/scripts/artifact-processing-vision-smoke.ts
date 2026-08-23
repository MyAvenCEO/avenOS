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
	throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status})`)
}

async function storeJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	return (await (await storeRequest(path, init)).json()) as Record<string, unknown>
}

function minimalPdf(text: string): Uint8Array {
	const safe = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
	const stream = `BT /F1 12 Tf 36 720 Td (${safe}) Tj ET\n`
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
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(pdf)
}

async function publish(kind: 'invoice' | 'statement'): Promise<string> {
	const text =
		kind === 'invoice'
			? 'ACME GmbH Invoice INV-2026-0815 Currency EUR Net 100.00 Tax 19.00 Gross 119.00 Due 2026-09-30'
			: 'Aven GmbH Account statement August 2026 Opening 1000.00 ACME -119.00 Closing 881.00'
	const bytes = minimalPdf(text)
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
			'content-type': 'application/pdf',
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
				rootActor: { kind: 'service', id: 'service:artifact-processing-vision-smoke' },
				artifacts: [
					{
						localKey: 'file',
						typeKey: 'core.file',
						typeVersion: 1,
						payload: {
							originalName: `${kind}-${publicationId}.pdf`,
							declaredMediaType: 'application/pdf',
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
	if (!Array.isArray(artifacts) || artifacts.length !== 1) throw new Error('Publication failed')
	const artifactId = (artifacts[0] as Record<string, unknown>).artifactId
	if (typeof artifactId !== 'string') throw new Error('Artifact ID is absent')
	return artifactId
}

async function awaitResult(artifactId: string): Promise<Record<string, unknown>> {
	const deadline = Date.now() + 90_000
	while (Date.now() < deadline) {
		const response = await fetch(
			`${processorUrl}/v1/scopes/${scopeId}/artifacts/${artifactId}/processing`,
			{ headers: { authorization: `Bearer ${processorToken}` } }
		)
		if (response.ok) {
			const status = (await response.json()) as Record<string, unknown>
			if (['succeeded', 'failed', 'needs_review'].includes(String(status.state))) return status
		} else if (response.status !== 404) {
			throw new Error(`Processor status failed (${response.status})`)
		}
		await Bun.sleep(200)
	}
	throw new Error(`Processor timed out for ${artifactId}`)
}

for (const kind of ['invoice', 'statement'] as const) {
	const artifactId = await publish(kind)
	const status = await awaitResult(artifactId)
	if (status.state !== 'succeeded') {
		throw new Error(`${kind} ended in ${String(status.state)}: ${JSON.stringify(status.warnings)}`)
	}
	const expectedType = kind === 'invoice' ? 'invoice' : 'monthly-statement'
	if (status.preferredType !== expectedType) {
		throw new Error(`${kind} preferred type is ${String(status.preferredType)}`)
	}
	const derived = status.derivedArtifacts
	if (!Array.isArray(derived)) throw new Error(`${kind} derived artifacts are absent`)
	const types = new Set(derived.map((artifact) => artifact.typeKey))
	const required =
		kind === 'invoice'
			? [
					'docs.extracted-text',
					'docs.text-layout',
					'core.document-classification',
					'bookkeeping.invoice-candidate',
					'bookkeeping.invoice-details',
					'bookkeeping.invoice-validation'
				]
			: [
					'docs.extracted-text',
					'docs.text-layout',
					'core.document-classification',
					'banking.account-statement-candidate',
					'banking.statement-validation'
				]
	for (const type of required) {
		if (!types.has(type)) throw new Error(`${kind} derived type ${type} is absent`)
	}
	console.log(
		JSON.stringify({ status: 'ok', kind, artifactId, stages: (status.stages as unknown[]).length })
	)
}
