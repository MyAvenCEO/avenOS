import { randomUUID } from 'node:crypto'
import {
	authorizeRegistryForPlanning,
	compileStudioSkillV2Execution,
	composeCatalogOperation,
	executePhysicalProgram,
	newStudioSkillV2,
	StudioCatalog,
	TrustedActorInstallations,
	type StudioCatalogEntry
} from '@avenos/actors'
import type { ArtifactStoreClient } from '@avenos/artifact-store'
import { describe, expect, test, vi } from 'vitest'
import { ArtifactStoreRuntimePort } from '../src/artifact-store-port'
import { StudioArtifacts, type StudioArtifact } from '../src/studio-artifacts'
import { StudioV2Authoring } from '../src/studio-v2-authoring'
import type { StudioV2DraftRecord, StudioV2DraftStore } from '../src/studio-v2-drafts'
import {
	STUDIO_SKILL_V2_TYPE_DIGEST,
	StudioV2SkillPublisher
} from '../src/studio-v2-publisher'
import {
	createStudioRuntimeAuthorizer,
	createStudioRuntimeFactory,
	createStudioRuntimeRegistry,
	installStudioRuntimeActors,
	STUDIO_BRIEF_SCHEMA,
	STUDIO_EMAIL_BRIEF_CAPABILITY,
	STUDIO_EMAIL_SCHEMA
} from '../src/studio-runtime'

describe('productive Skill Studio flow', () => {
	test('discovers, composes, saves, publishes and executes a Skill with causal Store output', async () => {
		const scope = randomUUID()
		const subject = randomUUID()
		const sourceId = randomUUID()
		const epoch = randomUUID()
		const installations = new TrustedActorInstallations()
		await installStudioRuntimeActors(installations)
		const registry = createStudioRuntimeRegistry()
		const authorizer = createStudioRuntimeAuthorizer(scope)
		const principal = { subjectId: subject, kind: 'user' as const, assurance: ['passkey'] }
		const access = { tenantId: scope }
		const security = {
			principal,
			access,
			establishedBy: 'test',
			authorizedAt: '2026-09-16T08:00:00Z'
		}
		const catalog = await new StudioCatalog().page({
			registry: registry.snapshot(),
			principal,
			access,
			authorizer,
			runtimeSupports: (_actorId, capabilityId) =>
				capabilityId === STUDIO_EMAIL_BRIEF_CAPABILITY,
			installationFor: (actorId) => installations.get(actorId)
		})
		const operation = catalog.entries.find(
			(entry) => entry.capabilityId === STUDIO_EMAIL_BRIEF_CAPABILITY
		) as StudioCatalogEntry
		expect(operation).toMatchObject({ canAuthor: true, canInvokeNow: false, readiness: 'needs-input' })

		const composed = composeCatalogOperation(newStudioSkillV2('Incoming email brief'), operation)
		expect(composed.cues).toEqual([
			{ kind: 'new-input', name: 'email', from: 'email' }
		])

		const records = new Map<string, StudioArtifact>()
		records.set(sourceId, {
			artifactId: sourceId,
			scopeId: scope,
			artifactSha256: '1'.repeat(64),
			typeKey: 'studio.email',
			typeVersion: 1,
			payload: {
				sourceArtifactId: randomUUID(),
				occurrenceId: randomUUID(),
				subject: 'Quarterly review',
				from: 'finance@example.test',
				receivedAt: '2026-09-16T08:00:00Z'
			},
			scopeSequence: 1,
			publicationId: randomUUID(),
			committedAt: '2026-09-16T08:00:00Z'
		})
		const publications: Array<{ id: string; intent: any }> = []
		const client = {
			context: async () => ({ storeEpoch: epoch }),
			type: async () => ({
				typeKey: 'studio.skill',
				version: 2,
				typeDefinitionSha256: STUDIO_SKILL_V2_TYPE_DIGEST
			}),
			artifact: async (_scope: string, id: string) => {
				const found = records.get(id)
				if (!found) throw new Error('RESOURCE_UNAVAILABLE')
				return structuredClone(found)
			},
			publish: vi.fn(async (_scope: string, id: string, _epoch: string, body: any) => {
				const prior = publications.find((publication) => publication.id === id)
				if (prior) {
					return {
						publicationId: id,
						artifacts: body.intent.artifacts.map((artifact: any) => {
							const found = [...records.values()].find(
								(record) => record.publicationId === id && record.typeKey === artifact.typeKey
							)
							return { localKey: artifact.localKey, artifactId: found!.artifactId }
						})
					}
				}
				publications.push({ id, intent: structuredClone(body.intent) })
				const committed = body.intent.artifacts.map((artifact: any, index: number) => {
					const artifactId = randomUUID()
					records.set(artifactId, {
						artifactId,
						scopeId: scope,
						artifactSha256: String(index + 2).repeat(64).slice(0, 64),
						typeKey: artifact.typeKey,
						typeVersion: artifact.typeVersion,
						payload: structuredClone(artifact.payload),
						scopeSequence: records.size + 1,
						publicationId: id,
						committedAt: '2026-09-16T08:01:00Z'
					})
					return { localKey: artifact.localKey, artifactId }
				})
				return { publicationId: id, artifacts: committed }
			})
		} as unknown as ArtifactStoreClient
		const artifacts = new StudioArtifacts(client, scope)
		const draftRows = new Map<string, StudioV2DraftRecord>()
		const drafts: StudioV2DraftStore = {
			list: async () => [...draftRows.values()],
			get: async (id) => structuredClone(draftRows.get(id)!),
			save: async (input) => {
				const row: StudioV2DraftRecord = {
					id: input.id,
					subjectId: subject,
					revision: input.revision + 1,
					definition: structuredClone(composed.definition),
					publishedArtifactId: null,
					publishedRevision: null,
					updatedAt: '2026-09-16T08:00:30Z'
				}
				draftRows.set(row.id, row)
				return structuredClone(row)
			},
			markPublished: async (id, _subjectId, revision, artifactId) => {
				const row = draftRows.get(id)!
				const updated = {
					...row,
					publishedArtifactId: artifactId,
					publishedRevision: revision
				}
				draftRows.set(id, updated)
				return structuredClone(updated)
			}
		}
		const publicationAuthority = {
			principal,
			access,
			actorAuthorizer: authorizer,
			assertCanPublish: async () => {},
			resolveReadableSkill: (id: string) => artifacts.get(id)
		}
		const authoring = new StudioV2Authoring(
			drafts,
			new StudioV2SkillPublisher(artifacts, installations),
			() => publicationAuthority
		)
		const draft = await authoring.save(
			{ id: randomUUID(), revision: 0, definition: composed.definition },
			security
		)
		const published = await authoring.publish(draft.id, draft.revision, security)
		expect(published.artifact).toMatchObject({ typeKey: 'studio.skill', typeVersion: 2 })

		const view = await authorizeRegistryForPlanning(registry.snapshot(), principal, authorizer, {
			access
		})
		const program = compileStudioSkillV2Execution({
			definition: published.artifact.payload,
			view,
			executionEnvironment: 'server',
			inputs: { email: sourceId }
		})
		const runtimeArtifacts = new ArtifactStoreRuntimePort({
			client,
			scopeId: scope,
			initiator: { kind: 'user', id: `user:${subject}` },
			schemas: [
				{
					schema: STUDIO_EMAIL_SCHEMA,
					typeKey: 'studio.email',
					typeVersion: 1,
					project: (_payload, artifactId) => [`ceo.aven.studio.email(${artifactId})`]
				},
				{
					schema: STUDIO_BRIEF_SCHEMA,
					typeKey: 'studio.brief',
					typeVersion: 1,
					project: (payload) => [
						`ceo.aven.studio.brief(${String((payload as any).sourceArtifactId)})`
					]
				}
			],
			procedures: [
				{
					capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
					procedureKey: 'studio.email-brief',
					procedureVersion: '1',
					executor: { kind: 'service', id: 'actor-runner' },
					implementation: { adapter: 'generic-actor-runtime', version: 1 }
				}
			]
		})
		const factory = createStudioRuntimeFactory()
		const execution = await executePhysicalProgram({
			runId: randomUUID(),
			program,
			registry: registry.snapshot(),
			principal,
			access,
			authorizer,
			factories: { resolve: (id) => (id === factory.offer.factoryId ? factory : undefined) },
			artifacts: runtimeArtifacts
		})

		expect(execution.completedStepIds).toEqual(['root.create'])
		expect(execution.remainingGoals).toEqual([])
		expect(execution.artifacts[0]).toMatchObject({
			typeKey: 'studio.brief',
			value: {
				sourceArtifactId: sourceId,
				title: 'Quarterly review',
				summary: 'Email from finance@example.test: Quarterly review',
				status: 'complete'
			}
		})
		const production = publications.find(
			(publication) => publication.intent.run.procedureKey === 'studio.email-brief'
		)!.intent
		expect(production.run.inputs).toEqual([
			{ role: 'source', ordinal: 0, artifactId: sourceId }
		])
		expect(production.artifacts[0]).toMatchObject({
			typeKey: 'studio.brief',
			output: { role: 'result', ordinal: 0 }
		})
	})

	test('preserves an explicit dependency on the terminal step of a nested Skill', async () => {
		const scope = randomUUID()
		const principal = { subjectId: randomUUID(), kind: 'user' as const, assurance: ['passkey'] }
		const registry = createStudioRuntimeRegistry()
		const installations = new TrustedActorInstallations()
		await installStudioRuntimeActors(installations)
		const view = await authorizeRegistryForPlanning(
			registry.snapshot(),
			principal,
			createStudioRuntimeAuthorizer(scope),
			{ access: { tenantId: scope } }
		)
		const operation = (
			await new StudioCatalog().page({
				registry: registry.snapshot(),
				principal,
				access: { tenantId: scope },
				authorizer: createStudioRuntimeAuthorizer(scope),
				runtimeSupports: () => true,
				installationFor: (actorId) => installations.get(actorId)
			})
		).entries[0]!
		const child = composeCatalogOperation(newStudioSkillV2('Nested brief'), operation).definition
		const childId = randomUUID()
		const root = newStudioSkillV2('Ordered nested brief')
		const { from: _from, ...briefPort } = child.outputs.brief!
		root.inputs.email = structuredClone(child.inputs.email!)
		root.steps.push({
			id: 'nested',
			kind: 'skill',
			label: 'Nested brief',
			skillArtifactId: childId,
			skillVersion: 2,
			inputs: { email: { kind: 'input', port: 'email' } },
			parameters: {},
			outputs: { brief: structuredClone(briefPort) }
		})
		root.steps.push({
			id: 'follow',
			kind: 'invoke',
			label: 'Follow-up brief',
			after: ['nested'],
			capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
			inputs: { email: { kind: 'input', port: 'email' } },
			parameters: {},
			outputs: { brief: structuredClone(briefPort) }
		})
		root.outputs.brief = {
			...child.outputs.brief!,
			from: { kind: 'step', stepId: 'follow', port: 'brief' }
		}
		const program = compileStudioSkillV2Execution({
			definition: root,
			children: new Map([[childId, child]]),
			view,
			executionEnvironment: 'server',
			inputs: { email: randomUUID() }
		})
		expect(program.steps.map((step) => step.id)).toEqual(['root.nested.create', 'root.follow'])
		expect(program.steps[1]!.dependsOn).toContain('root.nested.create')
	})
})
