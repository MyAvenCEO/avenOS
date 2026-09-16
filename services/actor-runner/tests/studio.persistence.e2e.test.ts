import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
	composeCatalogOperation,
	composeSkillArtifact,
	newStudioSkillV2,
	type PlanRunSecurityContext,
	type StudioCatalogEntry,
	TrustedActorInstallations
} from '@avenos/actors'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDocumentCatalogSource } from '../src/document-catalog.js'
import { SqlPlanRunner } from '../src/sql-runner.js'
import { StudioArtifacts, studioObject } from '../src/studio-artifacts.js'
import {
	createStudioRuntimeAuthorizer,
	createStudioRuntimeFactory,
	createStudioRuntimeRegistry,
	installStudioRuntimeActors,
	STUDIO_EMAIL_BRIEF_CAPABILITY
} from '../src/studio-runtime.js'
import { StudioService } from '../src/studio-service.js'
import { createStudioV2Executor } from '../src/studio-v2-executor.js'

const databaseUrl = process.env.TEST_ACTOR_RUNNER_DATABASE_URL
const baseUrl = process.env.TEST_ARTIFACT_STORE_BASE_URL
const bearerToken = process.env.TEST_ARTIFACT_STORE_BEARER_TOKEN
const scope = process.env.TEST_ARTIFACT_STORE_SCOPE_ID
const enabled = !!(databaseUrl && baseUrl && bearerToken && scope)
const schema = `studio_v2_e2e_${randomUUID().replaceAll('-', '')}`
const subject = randomUUID()
const security: PlanRunSecurityContext = {
	principal: { subjectId: subject, kind: 'user', assurance: ['passkey'] },
	access: { tenantId: scope! },
	establishedBy: 'studio-v2-persistence-test',
	authorizedAt: new Date().toISOString()
}

let admin: pg.Pool
let pool: pg.Pool
let runner: SqlPlanRunner
let service: StudioService
let store: StudioArtifacts
let client: ArtifactStoreClient
let installations: TrustedActorInstallations

const call = (
	operation: string,
	data: Record<string, unknown> = {},
	readOnly = false
): Promise<any> => service.call({ operation, data }, security, {}, readOnly)

function startService() {
	const registry = createStudioRuntimeRegistry()
	const factory = createStudioRuntimeFactory()
	runner = new SqlPlanRunner(
		pool,
		pool,
		createStudioV2Executor(store, {
			registryFor: () => registry.snapshot(),
			authorizerFor: () => createStudioRuntimeAuthorizer(scope!),
			factoriesFor: () => ({
				resolve: (id) => (id === factory.offer.factoryId ? factory : undefined)
			}),
			installations
		})
	)
	service = new StudioService(
		pool,
		store,
		runner,
		createDocumentCatalogSource(scope!, installations),
		installations
	)
}

async function publish(definition: unknown) {
	const draft = await call('draft', { id: randomUUID(), revision: 0, definition })
	return call('publish', { id: draft.id, revision: draft.revision })
}

async function settle(expected: number) {
	const deadline = Date.now() + 45_000
	while (Date.now() < deadline) {
		await call('sync')
		const state = await call('state')
		if (state.connections.some((row: any) => row.last_error))
			throw new Error(`Connection failed: ${JSON.stringify(state.connections)}`)
		if (state.deliveries.some((row: any) => row.last_error))
			throw new Error(`Delivery failed: ${JSON.stringify(state.deliveries)}`)
		if (state.runs.some((row: any) => row.state === 'failed'))
			throw new Error(`Execution failed: ${JSON.stringify(state.runs)}`)
		if (state.runs.filter((row: any) => row.state === 'succeeded').length >= expected) return state
		await new Promise((resolve) => setTimeout(resolve, 80))
	}
	throw new Error(`Studio did not settle: ${JSON.stringify(await call('state'))}`)
}

;(enabled ? describe : describe.skip)(
	'v2 Studio with PostgreSQL and the production Artifact Store',
	() => {
		beforeAll(async () => {
			admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
			await admin.query(`CREATE SCHEMA ${schema}`)
			for (const migration of ['0001_actor_runs', '0002_studio']) {
				const sql = await readFile(
					new URL(
						`../../platform-provisioner/components/actor-runs/${migration}.sql`,
						import.meta.url
					),
					'utf8'
				)
				await admin.query(sql.replaceAll('aven_actor_runs.', `${schema}.`))
			}
			pool = new pg.Pool({
				connectionString: databaseUrl,
				max: 8,
				options: `-c search_path=${schema},pg_catalog`
			})
			client = new ArtifactStoreClient({ baseUrl: baseUrl!, bearerToken: () => bearerToken! })
			store = new StudioArtifacts(client, scope!)
			installations = new TrustedActorInstallations()
			await installStudioRuntimeActors(installations)
			startService()
		})
		afterAll(async () => {
			await runner?.close()
			await pool?.end()
			if (admin) {
				await admin.query(`DROP SCHEMA ${schema} CASCADE`)
				await admin.end()
			}
		})

		test('exact nested Skill, connection delivery, Store lineage, replay and restart', async () => {
			const page = await call('catalog')
			const operation = page.entries.find(
				(entry: StudioCatalogEntry) => entry.capabilityId === STUDIO_EMAIL_BRIEF_CAPABILITY
			) as StudioCatalogEntry
			expect(operation).toMatchObject({ canAuthor: true, canPlan: true, readiness: 'needs-input' })
			const childDefinition = composeCatalogOperation(
				newStudioSkillV2('Email brief child'),
				operation
			).definition
			const child = await publish(childDefinition)
			const rootDefinition = composeSkillArtifact(
				newStudioSkillV2('Connected email brief'),
				child.artifact.artifactId,
				childDefinition
			).definition
			const root = await publish(rootDefinition)
			const first = await call('sample', {
				requestId: randomUUID(),
				observedAt: new Date().toISOString()
			})
			const connectionId = randomUUID()
			await call('connect', {
				id: connectionId,
				name: 'New email → brief',
				skillArtifactId: root.artifact.artifactId,
				sourceArtifactId: first.source.artifactId,
				inputPort: 'email',
				fixedInputs: {},
				parameters: {},
				enabled: true
			})
			const capture = { requestId: randomUUID(), observedAt: new Date().toISOString() }
			const incoming = await call('sample', capture)
			let state = await settle(1)
			expect(state.runs).toHaveLength(1)
			const output = state.runs[0].checkpoints
				.map((checkpoint: any) => checkpoint.output?.artifact)
				.find((artifact: any) => artifact?.typeKey === 'studio.brief')
			expect(output).toBeTruthy()
			const productionInputs = studioObject(await client.producerInputs(scope!, output.artifactId))
				.inputs as Array<{ role: string; artifactId: string }>
			const activationId = productionInputs.find((input) => input.role === 'activation')?.artifactId
			expect(activationId).toBeTruthy()
			expect(productionInputs).toContainEqual({
				role: 'program',
				ordinal: 0,
				artifactId: root.artifact.artifactId
			})
			expect(
				productionInputs.some(
					(input) =>
						input.role === 'source' &&
						incoming.artifacts.some((artifact: any) => artifact.artifactId === input.artifactId)
				)
			).toBe(true)
			const activation = await store.get(activationId!)
			expect(activation.payload.skillArtifactId).toBe(root.artifact.artifactId)
			const activationInputs = studioObject(
				await client.producerInputs(scope!, activationId!)
			).inputs
			expect(activationInputs).toContainEqual({
				role: 'program',
				ordinal: 0,
				artifactId: root.artifact.artifactId
			})
			expect(
				(
					(await store.get(root.artifact.artifactId)).payload.steps as Array<{
						skillArtifactId: string
					}>
				)[0]?.skillArtifactId
			).toBe(child.artifact.artifactId)
			await call('sample', capture)
			await call('sync')
			expect((await call('state')).runs).toHaveLength(1)
			const connection = state.connections.find((row: any) => row.id === connectionId)
			const paused = await call('control', {
				id: connection.id,
				revision: connection.revision,
				enabled: false
			})
			await call('sample', { requestId: randomUUID(), observedAt: new Date().toISOString() })
			expect((await call('state')).runs).toHaveLength(1)
			await runner.close()
			startService()
			await call('control', { id: paused.id, revision: paused.revision, enabled: true })
			state = await settle(2)
			expect(state.runs).toHaveLength(2)
		}, 60_000)

		test('draft CAS, read-only boundary and cross-subject publication stay closed', async () => {
			const definition = newStudioSkillV2('Agent-authored draft')
			const draft = await call('draft', { id: randomUUID(), revision: 0, definition })
			await call('draft', {
				id: draft.id,
				revision: draft.revision,
				definition: { ...definition, name: 'Agent-edited draft' }
			})
			await expect(
				call('draft', { id: draft.id, revision: draft.revision, definition })
			).rejects.toThrow('DRAFT_CHANGED')
			await expect(call('sample', {}, true)).rejects.toThrow('write access')
			const foreign = { ...security, principal: { ...security.principal, subjectId: randomUUID() } }
			await expect(
				service.call(
					{ operation: 'publish', data: { id: draft.id, revision: 2 } },
					foreign,
					{},
					false
				)
			).rejects.toThrow('DRAFT_UNAVAILABLE')
		})
	}
)
