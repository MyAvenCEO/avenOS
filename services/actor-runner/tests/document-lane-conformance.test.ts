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
	documentRunStartRequest,
	RemoteDocumentExecutionHost
} from '@avenos/document-ingest/execution'
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

describe('document execution lane conformance', () => {
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
	return btoa(String.fromCharCode(...bytes))
}
