import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
	composeCatalogOperation,
	composeSkillArtifact,
	newStudioSkillV2,
	type PlanRunSecurityContext,
	parseStudioSkillV2,
	type StudioCatalogEntry,
	TrustedActorInstallations
} from '@avenos/actors'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDocumentCatalogSource } from '../src/document-catalog.js'
import {
	createDocumentRuntimeFactories,
	installDocumentRuntimeActors
} from '../src/document-runtime.js'
import { installedAuthorizer, installedRegistry } from '../src/installed-runtime.js'
import {
	createMarkdownRuntimeFactory,
	installMarkdownRuntimeActor
} from '../src/markdown-runtime.js'
import { SqlPlanRunner } from '../src/sql-runner.js'
import { StudioArtifacts, studioObject } from '../src/studio-artifacts.js'
import {
	createStudioRuntimeFactory,
	installStudioRuntimeActors,
	STUDIO_EMAIL_BRIEF_CAPABILITY
} from '../src/studio-runtime.js'
import { StudioService } from '../src/studio-service.js'
import { StudioV2DraftConflict } from '../src/studio-v2-drafts.js'
import { createStudioV2Executor } from '../src/studio-v2-executor.js'
import { GoldenInvoiceModel } from './support/golden-document-model.js'
import { invoiceReviewSkills } from './support/studio-scenarios.js'

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
const documentModel = new GoldenInvoiceModel()

const call = (
	operation: string,
	data: Record<string, unknown> = {},
	readOnly = false
): Promise<any> => service.call({ operation, data }, security, {}, readOnly)

function startService() {
	const factories = [
		createStudioRuntimeFactory(),
		...createDocumentRuntimeFactories(store, documentModel),
		createMarkdownRuntimeFactory(store)
	]
	const offers = factories.map((f) => f.offer)
	const registry = installedRegistry(installations, offers)
	runner = new SqlPlanRunner(
		pool,
		pool,
		createStudioV2Executor(store, {
			registryFor: () => registry.snapshot(),
			authorizerFor: () => installedAuthorizer(scope!, installations),
			factoriesFor: () => ({
				resolve: (id) => factories.find((f) => f.offer.factoryId === id)
			}),
			installations
		})
	)
	service = new StudioService(
		pool,
		store,
		runner,
		createDocumentCatalogSource(scope!, installations, offers),
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
			for (const migration of [
				'0001_actor_runs',
				'0002_studio',
				'0003_studio_origin',
				'0004_execution_journal'
			]) {
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
			await installDocumentRuntimeActors(installations)
			await installMarkdownRuntimeActor(installations)
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
			const realCase = {
				title: 'Connected email brief',
				situation: 'A project email arrived',
				outcome: 'A reusable brief',
				evidence: [
					{
						id: 'memory',
						kind: 'recollection',
						sourceId: 'user',
						locator: '',
						quote: 'I used to summarize each new project email manually.',
						interpretation: 'User-reported procedure, not an execution receipt.'
					}
				],
				steps: [
					{
						id: 'brief',
						label: 'Prepare brief',
						kind: 'skill',
						artifactId: child.artifact.artifactId,
						evidenceIds: ['memory']
					}
				],
				uncertainties: []
			}
			const proposal = await call('case-propose', { case: realCase })
			await expect(call('case-build', { artifactId: proposal.artifactId })).rejects.toThrow(
				'Confirm this case'
			)
			const confirmed = await call('case-confirm', { artifactId: proposal.artifactId })
			const caseDraft = await call('case-build', { artifactId: confirmed.artifactId })
			const { caseArtifactId: _origin, ...detachedDefinition } = caseDraft.definition
			await expect(
				call('draft', {
					id: caseDraft.id,
					revision: caseDraft.revision,
					definition: detachedDefinition
				})
			).rejects.toBeInstanceOf(StudioV2DraftConflict)
			const unchangedDraft = (await call('state')).drafts.find(
				(draft: any) => draft.id === caseDraft.id
			)
			expect(unchangedDraft.revision).toBe(caseDraft.revision)
			expect(unchangedDraft.definition.caseArtifactId).toBe(caseDraft.definition.caseArtifactId)
			const refinedDraft = await call('draft', {
				id: caseDraft.id,
				revision: caseDraft.revision,
				definition: {
					...caseDraft.definition,
					name: 'Refined connected brief',
					inputs: {
						...caseDraft.definition.inputs,
						related: { ...caseDraft.definition.inputs.email, cardinality: 'many' },
						background: { ...caseDraft.definition.inputs.email, cardinality: 'optional' }
					}
				}
			})
			expect(await call('case-build', { artifactId: confirmed.artifactId })).toEqual(refinedDraft)
			const root = await call('publish', { id: refinedDraft.id, revision: refinedDraft.revision })
			expect(root.artifact.payload.caseArtifactId).toBe(confirmed.artifactId)
			const origin = studioObject(
				await client.producerInputs(scope!, root.artifact.artifactId)
			).inputs
			expect(origin).toContainEqual({ role: 'case', ordinal: 0, artifactId: confirmed.artifactId })
			const correction = await call('case-propose', {
				case: { ...realCase, outcome: 'Also mention urgent deadlines' },
				predecessorArtifactId: confirmed.artifactId
			})
			expect(correction.payload.status).toBe('proposed')
			expect((await store.get(confirmed.artifactId)).payload.predecessorArtifactId).toBe(
				proposal.artifactId
			)
			const first = await call('sample', {
				requestId: randomUUID(),
				observedAt: new Date().toISOString()
			})
			const connectionId = randomUUID()
			const firstEmail = first.artifacts.find((a: any) => a.typeKey === 'studio.email').artifactId
			const firstFile = first.artifacts.find((a: any) => a.typeKey === 'core.file').artifactId
			const connectionCommand = {
				id: connectionId,
				name: 'New email → brief',
				skillArtifactId: root.artifact.artifactId,
				sourceArtifactId: first.source.artifactId,
				inputPort: 'email',
				collection: { mode: 'each', initial: [] },
				origin: null,
				fixedInputs: { related: [firstEmail], background: null },
				parameters: {},
				enabled: true
			}
			await expect(
				call('connect', { ...connectionCommand, fixedInputs: { related: [firstFile] } })
			).rejects.toThrow('related input has the wrong type')
			await expect(
				call('connect', { ...connectionCommand, fixedInputs: { email: firstEmail } })
			).rejects.toThrow('an arrival supplies its own input')
			await expect(
				call('connect', {
					...connectionCommand,
					fixedInputs: { background: [firstEmail, firstEmail] }
				})
			).rejects.toThrow('background')
			const connected = await call('connect', connectionCommand)
			expect(
				studioObject(await client.producerInputs(scope!, connected.artifactId)).inputs
			).toContainEqual({ role: 'fixed', ordinal: 0, artifactId: firstEmail })
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
			expect(activation.payload.inputs).toMatchObject({ related: [firstEmail], background: null })
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

		test('supplier invoice: three reusable children, real PDF, immutable refinement and a second parent', async () => {
			const catalog = await call('catalog', { limit: 100 })
			const scenario = await invoiceReviewSkills(
				catalog.entries,
				async (definition) => (await publish(definition)).artifact.artifactId
			)
			const pdf = await readFile(
				new URL('../../../deploy/e2e/fixtures/e2e-invoice.pdf', import.meta.url)
			)
			const [source] = await store.publish({
				id: randomUUID(),
				principal: subject,
				procedure: 'studio.fixture-capture',
				inputs: [],
				parameters: {},
				artifacts: [
					{
						key: 'invoice',
						type: 'core.file',
						payload: {
							originalName: 'supplier-invoice.pdf',
							declaredMediaType: 'application/pdf',
							sourceKind: 'synthetic-test'
						},
						bytes: pdf
					}
				]
			})
			const parent = await publish(scenario.parent)
			async function run(id: string, inputs: Record<string, string> = {}) {
				const requestId = randomUUID()
				const handle = await call('start', {
					requestId,
					skillArtifactId: id,
					inputs,
					parameters: {}
				})
				for (let attempt = 0; attempt < 400; attempt++) {
					const record = await runner.status(handle.runId)
					if (record?.state === 'failed') throw Error(JSON.stringify(record))
					if (record?.state === 'succeeded') {
						expect(
							(await call('start', { requestId, skillArtifactId: id, inputs, parameters: {} }))
								.runId
						).toBe(handle.runId)
						return record.checkpoints.at(-1)!.output as { outputs: Record<string, string[]> }
					}
					await new Promise((resolve) => setTimeout(resolve, 50))
				}
				throw Error('Nested supplier review did not finish')
			}
			const result = await run(parent.artifact.artifactId, { source: source!.artifactId })
			expect((await store.get(result.outputs.invoice![0]!)).payload).toMatchObject({
				grossMinor: 11900,
				invoiceNumber: 'DE-2025-00001'
			})
			expect((await store.get(result.outputs['open-item']![0]!)).typeKey).toBe(
				'bookkeeping.open-item'
			)
			const original = result.outputs.checklist![0]!
			expect(new TextDecoder().decode(await client.content(scope!, original))).toContain(
				'Approve payment manually'
			)
			expect(documentModel.requests.map((r) => r.procedure)).toEqual([
				'classify-document',
				'extract-invoice'
			])
			const refs = studioObject(
				await client.producerInputs(scope!, parent.artifact.artifactId)
			).inputs
			for (const id of [scenario.extractId, scenario.validateId, scenario.noteId])
				expect(refs.some((r: any) => r.artifactId === id)).toBe(true)
			// Refine the checklist child. Existing parent pins its original artifact, not a name/latest alias.
			const refined = structuredClone(scenario.note)
			const write = refined.steps[0]!
			if (write.kind !== 'invoke') throw Error('Expected write')
			write.parameters.content = {
				kind: 'literal',
				value:
					'# Supplier review\n\n- [ ] Check credit-note exceptions\n- [ ] Approve payment manually\n'
			}
			const next = await publish(refined)
			const variant = structuredClone(scenario.parent)
			const child = variant.steps.at(-1)!
			if (child.kind !== 'skill') throw Error('Expected child')
			child.skillArtifactId = next.artifact.artifactId
			variant.name = 'Supplier review with credit-note checklist'
			const variantId = (await publish(variant)).artifact.artifactId
			const revised = await run(variantId, { source: source!.artifactId })
			expect(
				new TextDecoder().decode(await client.content(scope!, revised.outputs.checklist![0]!))
			).toContain('credit-note exceptions')
			const unchanged = await run(parent.artifact.artifactId, { source: source!.artifactId })
			expect(
				new TextDecoder().decode(await client.content(scope!, unchanged.outputs.checklist![0]!))
			).not.toContain('credit-note exceptions')
			const standalone = composeSkillArtifact(
				newStudioSkillV2('Monthly supplier review checklist'),
				next.artifact.artifactId,
				refined
			).definition
			expect(
				(await run((await publish(standalone)).artifact.artifactId)).outputs.document
			).toHaveLength(1)
			// Patch through the same Actor, preserving both bytes and causal history.
			const patch = catalog.entries.find((e: StudioCatalogEntry) =>
				e.capabilityId.endsWith(':patch@1')
			)
			const patchSkill = composeCatalogOperation(
				newStudioSkillV2('Mark review complete'),
				patch
			).definition
			const step = patchSkill.steps[0]!
			if (step.kind !== 'invoke') throw Error('Expected patch')
			step.parameters.edits = {
				kind: 'literal',
				value: [{ find: '- [ ] Check invoice totals', replace: '- [x] Check invoice totals' }]
			}
			patchSkill.parametersSchema = newStudioSkillV2('empty').parametersSchema
			const patched = await run((await publish(patchSkill)).artifact.artifactId, {
				document: original
			})
			expect(
				new TextDecoder().decode(await client.content(scope!, patched.outputs.document![0]!))
			).toContain('- [x] Check invoice totals')
			expect(
				studioObject(await client.producerInputs(scope!, patched.outputs.document![0]!)).inputs
			).toContainEqual({ role: 'document', ordinal: 0, artifactId: original })
			expect(new TextDecoder().decode(await client.content(scope!, original))).toContain(
				'- [ ] Check invoice totals'
			)
		}, 90_000)

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
