import { randomUUID } from 'node:crypto'
import { ACTOR_RUN_PROTOCOL, newStudioSkillV2, parseStudioSkillV2, TrustedActorInstallations } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import { StudioArtifacts } from '../src/studio-artifacts'
import { StudioService } from '../src/studio-service'
import { createStudioV2Executor, STUDIO_SKILL_V2 } from '../src/studio-v2-executor'
import {
	createStudioRuntimeAuthorizer,
	createStudioRuntimeFactory,
	createStudioRuntimeRegistry,
	installStudioRuntimeActors,
	STUDIO_BRIEF_SCHEMA,
	STUDIO_EMAIL_BRIEF_CAPABILITY,
	STUDIO_EMAIL_SCHEMA
} from '../src/studio-runtime'

async function executeFixture(options: {
	cancelledBefore?: boolean
	cancelAfterFirst?: boolean
	foreignInitiator?: boolean
	forgedPredicate?: boolean
	twoSteps?: boolean
} = {}) {
	const scope = randomUUID()
	const subject = randomUUID()
	const skillId = randomUUID()
	const activationId = randomUUID()
	const firstEmail = randomUUID()
	const secondEmail = randomUUID()
	const epoch = randomUUID()
	const input = {
		schema: STUDIO_EMAIL_SCHEMA,
		type: { key: 'studio.email', version: 1 },
		predicate: 'ceo.aven.studio.email(E)', role: 'source', cardinality: 'one' as const
	}
	const output = {
		schema: STUDIO_BRIEF_SCHEMA,
		type: { key: 'studio.brief', version: 1 },
		predicate: options.forgedPredicate
			? `ceo.aven.studio.brief(${randomUUID()})`
			: 'ceo.aven.studio.brief(E)',
		role: 'result', cardinality: 'one' as const
	}
	const step = (id: string, port: string) => ({
		id, kind: 'invoke' as const, label: id,
		capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
		inputs: { email: { kind: 'input' as const, port } }, parameters: {}, outputs: { brief: output }
	})
	const definition = parseStudioSkillV2({
		...newStudioSkillV2('Runtime safety'),
		inputs: { first: input, ...(options.twoSteps ? { second: input } : {}) },
		steps: [step('first', 'first'), ...(options.twoSteps ? [step('second', 'second')] : [])],
		outputs: { brief: { ...output, from: { kind: 'step', stepId: 'first', port: 'brief' } } }
	})
	const records: Map<string, any> = new Map()
	const add = (id: string, typeKey: string, typeVersion: number, payload: unknown, publicationId: string = randomUUID()) => {
		const artifact = { artifactId: id, scopeId: scope, artifactSha256: 'a'.repeat(64),
			typeKey, typeVersion, payload, scopeSequence: records.size + 1, publicationId,
			committedAt: '2026-09-16T12:00:00Z' }
		records.set(id, artifact)
		return artifact
	}
	add(firstEmail, 'studio.email', 1, { subject: 'First', from: 'first@example.test' })
	if (options.twoSteps) add(secondEmail, 'studio.email', 1, { subject: 'Second', from: 'second@example.test' })
	add(skillId, 'studio.skill', 2, definition)
	add(activationId, 'studio.activation', 2, {
		contractVersion: 2, activationId: randomUUID(), skillArtifactId: skillId,
		inputs: { first: firstEmail, ...(options.twoSteps ? { second: secondEmail } : {}) },
		parameters: {}, initiator: options.foreignInitiator ? randomUUID() : subject,
		origin: 'manual', subscriptionArtifactId: null
	})
	const controller = new AbortController()
	if (options.cancelledBefore) controller.abort(new Error('cancelled before execution'))
	const publications: any[] = []
	const client: any = {
		context: async () => ({ storeEpoch: epoch }),
		artifact: async (_scope: string, id: string) => structuredClone(records.get(id)),
		publish: async (_scope: string, publicationId: string, _epoch: string, body: any) => {
			publications.push(structuredClone(body.intent))
			const artifacts = body.intent.artifacts.map((draft: any) => {
				const committed = add(randomUUID(), draft.typeKey, draft.typeVersion, draft.payload, publicationId)
				return { localKey: draft.localKey, artifactId: committed.artifactId }
			})
			if (options.cancelAfterFirst && publications.length === 1)
				controller.abort(new Error('cancelled after first publication'))
			return { publicationId, artifacts }
		}
	}
	const artifacts = new StudioArtifacts(client, scope)
	const registry = createStudioRuntimeRegistry()
	const factory = createStudioRuntimeFactory()
	const installations = new TrustedActorInstallations()
	await installStudioRuntimeActors(installations)
	const executor = createStudioV2Executor(artifacts, {
		registryFor: () => registry.snapshot(),
		authorizerFor: () => createStudioRuntimeAuthorizer(scope),
		factoriesFor: () => ({ resolve: (id) => id === factory.offer.factoryId ? factory : undefined }),
		installations
	})
	const request: any = {
		protocol: ACTOR_RUN_PROTOCOL, requestId: randomUUID(), idempotencyKey: randomUUID(),
		requestedAt: new Date().toISOString(), skillRef: STUDIO_SKILL_V2,
		executionEnvironment: 'server',
		ingredients: [{ predicate: 'ceo.aven.studio.activation(request)', artifactId: activationId }],
		goals: ['ceo.aven.studio.completed(request)'], parameters: { activationArtifactId: activationId },
		security: { principal: { subjectId: subject, kind: 'user', assurance: ['passkey'] },
			access: { tenantId: scope }, establishedBy: 'test', authorizedAt: new Date().toISOString() }
	}
	try {
		return { result: await executor(request, { signal: controller.signal }), error: null,
			publications, firstEmail, secondEmail }
	} catch (error) {
		return { result: null, error, publications, firstEmail, secondEmail }
	}
}

describe('Studio v2 execution safety', () => {
	test('cancellation stops work before execution and between physical steps', async () => {
		const before = await executeFixture({ cancelledBefore: true })
		expect(before.error).toBeInstanceOf(Error)
		expect(before.publications).toHaveLength(0)
		const during = await executeFixture({ twoSteps: true, cancelAfterFirst: true })
		expect(during.error).toBeInstanceOf(Error)
		expect(during.publications).toHaveLength(1)
	})

	test('rechecks the installed contract and activation owner at execution admission', async () => {
		const forged = await executeFixture({ forgedPredicate: true })
		expect(String(forged.error)).toContain('STUDIO_RUNTIME_CONTRACT_INVALID')
		expect(forged.publications).toHaveLength(0)
		const foreign = await executeFixture({ foreignInitiator: true })
		expect(String(foreign.error)).toContain('STUDIO_ACTIVATION_SUBJECT_MISMATCH')
		expect(foreign.publications).toHaveLength(0)
	})

	test('returns the declared public result instead of the last internal publication', async () => {
		const executed = await executeFixture({ twoSteps: true })
		expect(executed.error).toBeNull()
		expect((executed.result!.output as any).artifact.payload.sourceArtifactId).toBe(executed.firstEmail)
		expect(executed.publications).toHaveLength(2)
	})

	test('rejects a connection whose hidden internal publication can retrigger it', async () => {
		const scope = randomUUID()
		const subject = randomUUID()
		const skillId = randomUUID()
		const emailId = randomUUID()
		const email = { schema: STUDIO_EMAIL_SCHEMA, type: { key: 'studio.email', version: 1 },
			predicate: 'ceo.aven.studio.email(E)', role: 'source', cardinality: 'one' as const }
		const brief = { schema: STUDIO_BRIEF_SCHEMA, type: { key: 'studio.brief', version: 1 },
			predicate: 'ceo.aven.studio.brief(E)', role: 'result', cardinality: 'one' as const }
		const definition = parseStudioSkillV2({ ...newStudioSkillV2('No feedback'),
			inputs: { trigger: brief, email }, steps: [{ id: 'create', kind: 'invoke', label: 'Create',
				capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
				inputs: { email: { kind: 'input', port: 'email' } }, parameters: {}, outputs: { brief } }],
			outputs: {} })
		const rows: Map<string, any> = new Map([[skillId, { artifactId: skillId, scopeId: scope, artifactSha256: 'a'.repeat(64),
			typeKey: 'studio.skill', typeVersion: 2, payload: definition }],
			[emailId, { artifactId: emailId, scopeId: scope, artifactSha256: 'b'.repeat(64),
				typeKey: 'studio.email', typeVersion: 1, payload: {} }]])
		const artifacts: any = { scope, get: async (id: string) => structuredClone(rows.get(id)), client: {} }
		const query = async () => ({ rows: [], rowCount: 0 })
		const database: any = { query, connect: async () => ({ query, release() {} }) }
		const service = new StudioService(database, artifacts, {} as any)
		await expect(service.call({ operation: 'connect', data: { id: randomUUID(), name: 'Loop',
			skillArtifactId: skillId, sourceArtifactId: null, inputPort: 'trigger',
			fixedInputs: { email: emailId }, parameters: {}, enabled: true } },
			{ principal: { subjectId: subject, kind: 'user', assurance: [] }, access: { tenantId: scope },
				establishedBy: 'test', authorizedAt: new Date().toISOString() }, {}, false))
			.rejects.toThrow('feedback loop')
	})
})
