import { createHash, randomUUID } from 'node:crypto'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import { createDocumentActors } from '@avenos/document-ingest/actors'
import type { DocumentModelRequest } from '@avenos/document-ingest/model'
import { DocumentProcessingRuntime } from '@avenos/document-ingest/runtime'
import { ArtifactStoreDocumentGateway, ServerDocumentDecoder } from '@avenos/document-ingest/server'
import { expect, test } from 'vitest'
import { textPdf } from '../../../libs/aven-document-ingest/tests/support/chunk-fixtures'
import { ArtifactFileService } from '../../aven-api/src/lib/server/artifacts/service'
import { GoldenInvoiceModel } from './support/golden-document-model'

const baseUrl = process.env.TEST_ARTIFACT_STORE_BASE_URL
const bearerToken = process.env.TEST_ARTIFACT_STORE_BEARER_TOKEN
const scopeId = process.env.TEST_ARTIFACT_STORE_SCOPE_ID

class ChunkStatementModel extends GoldenInvoiceModel {
	constructor() {
		super('bank-statement')
	}
	override async complete(request: DocumentModelRequest) {
		const result = await super.complete(request)
		if (request.procedure === 'extract-statement') {
			const candidate = result.structured.candidate!
			const first = candidate.transactions![0]!
			candidate.closingBalanceMinor = 4000
			candidate.transactions = Array.from({ length: 40 }, (_, index) => ({
				...first,
				transactionId: `TX-${(request.images[0]!.page - 1) * 40 + index + 1}`,
				amountMinor: -100,
				balanceAfterMinor: 20000 - ((request.images[0]!.page - 1) * 40 + index + 1) * 100,
				sourceRow: index + 1
			}))
		}
		return result
	}
}

;(baseUrl && bearerToken && scopeId ? test : test.skip)(
	'real store accepts every chunk, merged 160 rows and fanout, and restarts on both publication adapters',
	async () => {
		if (!baseUrl || !bearerToken || !scopeId) throw new Error('Store configuration required')
		const client = new ArtifactStoreClient({ baseUrl, bearerToken: () => bearerToken })
		const userId = randomUUID()
		const service = ArtifactFileService.fromConfig({
			ARTIFACT_STORE_BASE_URL: baseUrl,
			ARTIFACT_STORE_BEARER_TOKEN: bearerToken
		})!
		const remoteGateway = new ArtifactStoreDocumentGateway({ client, scopeId, userId })
		for (const financial of [false, true]) {
			const bytes = textPdf(
				Array.from({ length: financial ? 4 : 70 }, (_, index) => [
					`Source page ${index + 1}`,
					financial ? 'Bank statement' : 'Operations manual'
				])
			)
			const originalName = `${randomUUID()}.pdf`
			const sha256 = createHash('sha256').update(bytes).digest('hex'),
				claimId = randomUUID(),
				publicationId = randomUUID()
			await client.upload(
				scopeId,
				claimId,
				{ sha256, length: bytes.length, declaredMediaType: 'application/pdf' },
				bytes
			)
			const { storeEpoch } = (await client.context()) as { storeEpoch: string }
			const receipt = (await client.publish(scopeId, publicationId, storeEpoch, {
				intent: {
					commandVersion: 1,
					publicationId,
					scopeId,
					kind: 'roots',
					rootActor: { kind: 'user', id: `user:${userId}` },
					artifacts: [
						{
							localKey: 'source',
							typeKey: 'core.file',
							typeVersion: 1,
							payload: {
								originalName,
								declaredMediaType: 'application/pdf',
								sourceKind: 'client-actor-ingest',
								executionEnvironment: 'local'
							},
							blob: { sha256, length: bytes.length },
							references: [],
							output: null
						}
					],
					evidence: []
				},
				blobAuthorities: { source: { kind: 'upload-claim', claimId } }
			})) as { artifacts: { artifactId: string }[] }
			const source = {
				artifactId: receipt.artifacts[0]!.artifactId,
				originalName,
				declaredMediaType: 'application/pdf',
				base64: Buffer.from(bytes).toString('base64')
			}
			for (const environment of ['local', 'server'] as const) {
				const model = financial ? new ChunkStatementModel() : undefined
				const gateway =
					environment === 'server'
						? remoteGateway
						: {
								publish: (run: Parameters<typeof remoteGateway.publish>[0]) =>
									service.publishClientRun({
										...run,
										userId,
										scopeId,
										databaseName: 'aven_artifact_conformance'
									} as Parameters<typeof service.publishClientRun>[0]),
								lookup: (id: string) => client.committedClientRun(scopeId, id)
							}
				const options = {
					executionEnvironment: environment,
					runtimeHost: environment === 'server' ? ('actor-runner' as const) : ('desktop' as const),
					procedureVersion:
						environment === 'server' ? ('server-v1' as const) : ('client-v1' as const)
				}
				const actors = createDocumentActors(new ServerDocumentDecoder(), model)
				const result = await new DocumentProcessingRuntime(
					actors,
					gateway,
					model ? () => model.status() : undefined,
					options
				).start(source)
				expect(result.state, JSON.stringify(result)).toBe('succeeded')
				expect(result.metadata.completedChunks).toBe(financial ? 4 : 70)
				if (financial) {
					const transactions = result.derivedArtifacts.filter(
						(item) => item.typeKey === 'banking.transaction'
					)
					expect(transactions).toHaveLength(160)
					const payloads = await Promise.all(
						transactions.map(
							async (item) =>
								(
									(await client.artifact(scopeId, item.artifactId)) as {
										payload: { sourceOrdinal: number }
									}
								).payload
						)
					)
					expect(new Set(payloads.map((item) => item.sourceOrdinal)).size).toBe(160)
				}
				actors.all.forEach((actor) => {
					actor.dispose()
				})
				const before = model?.requests.length
				const replayActors = createDocumentActors(
					{
						decode: async () => {
							throw new Error('Unexpected replay decode')
						}
					},
					model
				)
				const replay = await new DocumentProcessingRuntime(
					replayActors,
					gateway,
					model ? () => model.status() : undefined,
					options
				).start(source)
				expect(replay.state).toBe('succeeded')
				expect(replay.stages.every((stage) => stage.attemptCount === 0)).toBe(true)
				expect(model?.requests.length).toBe(before)
				replayActors.all.forEach((actor) => {
					actor.dispose()
				})
			}
		}
	},
	120000
)
