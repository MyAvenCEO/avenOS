import { randomUUID } from 'node:crypto'
import { ArtifactStoreClient } from '@avenos/artifact-store'

/** Deterministic wire fixture, not the durable-store proof (see studio.persistence.e2e). */
export function studioStoreFixture(scope = randomUUID()) {
	let sequence = 0
	let epoch = randomUUID()
	let failAfterProcedure: string | null = null
	const artifacts = new Map<string, any>()
	const publications = new Map<string, any>()
	const uploads = new Map<string, ArrayBuffer>()
	const bytes = new Map<string, ArrayBuffer>()
	const json = (data: unknown, status = 200) =>
		new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
	const client = new ArtifactStoreClient({
		baseUrl: 'https://studio.test',
		bearerToken: () => 'synthetic-studio-fixture',
		fetch: async (input, init) => {
			const request = new Request(input, init)
			const url = new URL(request.url)
			const parts = url.pathname.split('/')
			if (url.pathname === '/v1/context') return json({ storeEpoch: epoch })
			if (parts[3] !== scope)
				return json({ code: 'RESOURCE_UNAVAILABLE', message: 'Unavailable' }, 404)
			if (parts[4] === 'uploads') {
				uploads.set(parts[5]!, await request.arrayBuffer())
				return json({ staged: true })
			}
			if (parts[4] === 'publications' && request.method === 'PUT') {
				if (
					request.headers.get('x-aven-store-epoch') !== epoch &&
					request.headers.get('x-store-epoch') !== epoch
				) {
					// Assert the SDK's actual precondition header below; it is not a lease.
					const epochHeader = [...request.headers].find(([key]) => key.includes('epoch'))
					if (epochHeader?.[1] !== epoch)
						return json({ code: 'STORE_EPOCH_MISMATCH', message: 'Store epoch changed' }, 409)
				}
				const { intent, blobAuthorities } = (await request.json()) as any
				const prior = publications.get(parts[5]!)
				if (prior) {
					if (JSON.stringify(prior.intent) !== JSON.stringify(intent))
						return json(
							{ code: 'PUBLICATION_CONFLICT', message: 'Different publication content' },
							409
						)
					return json({ ...prior.receipt, replayed: true })
				}
				const runId = randomUUID()
				for (const input of intent.run.inputs)
					if (!artifacts.has(input.artifactId))
						throw new Error('Missing causal artifact ' + input.artifactId)
				const outputs = intent.artifacts.map((a: any) => ({ ...a, artifactId: randomUUID() }))
				const publication = {
					publicationId: parts[5],
					scopeId: scope,
					scopeSequence: ++sequence,
					runId,
					artifacts: outputs,
					committedAt: new Date().toISOString()
				}
				for (const a of outputs) {
					const envelope = {
						...a,
						scopeId: scope,
						publicationId: parts[5],
						scopeSequence: sequence,
						committedAt: publication.committedAt,
						producerRunId: runId
					}
					artifacts.set(a.artifactId, envelope)
					if (a.blob) bytes.set(a.artifactId, uploads.get(blobAuthorities[a.localKey].claimId)!)
				}
				const receipt = { publicationId: parts[5], runId, artifacts: outputs, replayed: false }
				publications.set(parts[5]!, { publication, receipt, run: intent.run, intent })
				if (failAfterProcedure === intent.run.procedureKey) {
					failAfterProcedure = null
					throw new Error('Synthetic lost acknowledgement')
				}
				return json(receipt)
			}
			if (parts[4] === 'publications') {
				const pub = publications.get(parts[5]!)
				return pub
					? json({ publication: pub.publication, run: pub.run })
					: json({ code: 'RESOURCE_UNAVAILABLE', message: 'Unavailable' }, 404)
			}
			if (parts[4] === 'feed') {
				const after = Number(url.searchParams.get('afterSequence') ?? 0)
				const items = [...publications.values()]
					.map((p) => p.publication)
					.filter((p) => p.scopeSequence > after)
					.slice(0, Number(url.searchParams.get('limit') ?? 20))
				return json({
					storeEpoch: epoch,
					items,
					nextAfterSequence: items.at(-1)?.scopeSequence ?? null
				})
			}
			if (parts[4] === 'artifacts' && !parts[5]) {
				const items = [...artifacts.values()]
					.filter((a) => a.typeKey === url.searchParams.get('typeKey'))
					.slice(0, Number(url.searchParams.get('limit') ?? 128))
				return json({ snapshotSequence: sequence, items, nextAfter: null })
			}
			const a = artifacts.get(parts[5]!)
			if (!a) return json({ code: 'RESOURCE_UNAVAILABLE', message: 'Unavailable' }, 404)
			if (parts[6] === 'content') return new Response(bytes.get(a.artifactId))
			if (parts[6] === 'producer-inputs')
				return json({
					artifactId: a.artifactId,
					producerRunId: a.producerRunId,
					inputs: publications.get(a.publicationId).run.inputs
				})
			return json(a)
		}
	})
	return {
		client,
		scope,
		artifacts,
		publications,
		failNextAcknowledgement: (procedure: string) => {
			failAfterProcedure = procedure
		},
		changeEpoch: () => {
			epoch = randomUUID()
		}
	}
}
