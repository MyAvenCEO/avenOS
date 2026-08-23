import { basename, extname, resolve } from 'node:path'

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
const fixtureDirectory = resolve(
	process.env.ARTIFACT_PROCESSING_FIXTURE_DIRECTORY ?? '../../fixtures/artifacts'
)
const timeoutMs = Number(process.env.ARTIFACT_PROCESSING_TIMEOUT_MS ?? '300000')
const fixtureGlob = process.env.ARTIFACT_PROCESSING_FIXTURE_GLOB ?? '**/*'

if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
	throw new Error('ARTIFACT_PROCESSING_TIMEOUT_MS must be an integer of at least 1000')
}

const mediaTypes: Record<string, string> = {
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.pdf': 'application/pdf',
	'.png': 'image/png'
}

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

async function publish(path: string, storeEpoch: string): Promise<string> {
	const originalName = basename(path)
	const mediaType = mediaTypes[extname(originalName).toLowerCase()]
	if (!mediaType) throw new Error(`unsupported fixture extension: ${originalName}`)
	const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
	if (bytes.byteLength === 0) throw new Error(`fixture is empty: ${originalName}`)
	const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	const claimId = crypto.randomUUID()
	const publicationId = crypto.randomUUID()

	await storeRequest(`/v1/scopes/${scopeId}/uploads/${claimId}`, {
		method: 'PUT',
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': mediaType,
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
				rootActor: { kind: 'service', id: 'service:artifact-processing-fixtures-e2e' },
				artifacts: [
					{
						localKey: 'file',
						typeKey: 'core.file',
						typeVersion: 1,
						payload: {
							originalName,
							declaredMediaType: mediaType,
							sourceKind: 'processing-real'
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
		throw new Error(`source publication failed: ${originalName}`)
	}
	const artifactId = (artifacts[0] as Record<string, unknown>).artifactId
	if (typeof artifactId !== 'string') throw new Error(`artifact ID is absent: ${originalName}`)
	return artifactId
}

async function awaitTerminal(artifactId: string): Promise<Record<string, unknown>> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const response = await fetch(
			`${processorUrl}/v1/scopes/${scopeId}/artifacts/${artifactId}/processing`,
			{ headers: { authorization: `Bearer ${processorToken}` } }
		)
		if (response.ok) {
			const status = (await response.json()) as Record<string, unknown>
			if (['succeeded', 'failed', 'needs_review'].includes(String(status.state))) return status
		} else if (response.status !== 404) {
			throw new Error(`processor status failed (${response.status})`)
		}
		await Bun.sleep(500)
	}
	throw new Error(`processor timed out after ${timeoutMs}ms`)
}

function summarize(name: string, artifactId: string, status: Record<string, unknown>) {
	const stages = Array.isArray(status.stages) ? status.stages : []
	const derived = Array.isArray(status.derivedArtifacts) ? status.derivedArtifacts : []
	return {
		name,
		artifactId,
		caseId: status.caseId,
		state: status.state,
		preferredType: status.preferredType,
		stages: stages.map((stage) => ({
			key: (stage as Record<string, unknown>).key,
			state: (stage as Record<string, unknown>).state
		})),
		derivedTypes: derived.map((artifact) => (artifact as Record<string, unknown>).typeKey),
		warnings: status.warnings
	}
}

function assertFixture(name: string, status: Record<string, unknown>): string[] {
	const errors: string[] = []
	const stages = Array.isArray(status.stages)
		? (status.stages as Array<Record<string, unknown>>)
		: []
	if (/^\d{4}_/.test(name)) {
		if (status.state !== 'succeeded') errors.push(`expected succeeded, got ${String(status.state)}`)
		if (!['invoice', 'credit-note'].includes(String(status.preferredType))) {
			errors.push(`expected invoice-family presentation, got ${String(status.preferredType)}`)
		}
		const derived = new Set(
			(Array.isArray(status.derivedArtifacts) ? status.derivedArtifacts : []).map((artifact) =>
				String((artifact as Record<string, unknown>).typeKey)
			)
		)
		for (const type of [
			'bookkeeping.invoice-candidate',
			'bookkeeping.invoice-details',
			'bookkeeping.invoice-validation'
		]) {
			if (!derived.has(type)) errors.push(`missing ${type}`)
		}
		const metadata =
			typeof status.metadata === 'object' && status.metadata !== null
				? (status.metadata as Record<string, unknown>)
				: {}
		for (const field of ['supplier', 'invoiceNumber', 'currency', 'grossMinor']) {
			const value = metadata[field]
			if (value === null || value === undefined || value === '') {
				errors.push(`missing candidate ${field}`)
			}
		}
	} else if (name.startsWith('receipt_')) {
		if (status.state !== 'succeeded') errors.push(`expected succeeded, got ${String(status.state)}`)
		if (!['invoice', 'receipt', 'credit-note', 'self-issued-receipt'].includes(String(status.preferredType))) {
			errors.push(`unexpected finance presentation ${String(status.preferredType)}`)
		}
		const derived = new Set(
			(Array.isArray(status.derivedArtifacts) ? status.derivedArtifacts : []).map((artifact) =>
				String((artifact as Record<string, unknown>).typeKey)
			)
		)
		if (!derived.has('bookkeeping.invoice-candidate')) {
			errors.push('missing bookkeeping.invoice-candidate')
		}
	} else if (name === 'IM_00140.JPG') {
		if (status.state !== 'needs_review') {
			errors.push(`expected needs_review for non-finance image, got ${String(status.state)}`)
		}
		if (!stages.some((stage) => stage.key === 'decompose-pages' && stage.state === 'succeeded')) {
			errors.push('camera JPEG did not pass deterministic inspection and decomposition')
		}
		if (!stages.some((stage) => stage.key === 'analyze-page-001' && stage.state === 'succeeded')) {
			errors.push('camera JPEG did not reach non-finance page analysis')
		}
	}
	return errors
}

const files = Array.fromAsync(
	new Bun.Glob(fixtureGlob).scan({ cwd: fixtureDirectory, absolute: true, onlyFiles: true })
).then((paths) =>
	paths
		.filter((path) => mediaTypes[extname(path).toLowerCase()])
		.sort((left, right) => left.localeCompare(right))
)
const paths = await files
if (paths.length === 0) throw new Error(`no supported fixtures found in ${fixtureDirectory}`)

const context = await storeJson('/v1/context')
const storeEpoch = context.storeEpoch
if (typeof storeEpoch !== 'string') throw new Error('Store context has no epoch')

const results: unknown[] = []
const totals = { succeeded: 0, failed: 0, needsReview: 0, harnessErrors: 0, assertionErrors: 0 }
for (const [index, path] of paths.entries()) {
	const name = basename(path)
	console.error(`[${index + 1}/${paths.length}] importing ${name}`)
	try {
		const artifactId = await publish(path, storeEpoch)
		const status = await awaitTerminal(artifactId)
		const assertions = assertFixture(name, status)
		const summary = { ...summarize(name, artifactId, status), assertions }
		results.push(summary)
		console.log(JSON.stringify(summary))
		totals.assertionErrors += assertions.length
		if (status.state === 'succeeded') totals.succeeded += 1
		else if (status.state === 'needs_review') totals.needsReview += 1
		else totals.failed += 1
	} catch (error) {
		totals.harnessErrors += 1
		const summary = { name, state: 'harness-error', error: String(error) }
		results.push(summary)
		console.log(JSON.stringify(summary))
	}
}

console.error(JSON.stringify({ fixtures: paths.length, ...totals }))
if (totals.failed > 0 || totals.harnessErrors > 0 || totals.assertionErrors > 0) process.exitCode = 1
