import { randomUUID } from 'node:crypto'
import { TrustedActorInstallations } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import type { StudioArtifact } from '../src/studio-artifacts'
import { StudioV2Previewer } from '../src/studio-v2-preview'
import { StudioV2SkillValidator } from '../src/studio-v2-validation'
import {
	installStudioRuntimeActors,
	STUDIO_EMAIL_BRIEF_CAPABILITY,
	STUDIO_EMAIL_SCHEMA
} from '../src/studio-runtime'

const port = {
	schema: 'fixture:input@1',
	type: { key: 'fixture.input', version: 1 },
	predicate: 'fixture.input(X)',
	role: 'source',
	cardinality: 'one'
}
function leaf() {
	return {
		version: 2,
		name: 'Leaf',
		inputs: { source: port },
		parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
		steps: [],
		outputs: { source: { ...port, from: { kind: 'input', port: 'source' } } },
		policy: {
			maxInvocations: 8,
			maxDepth: 4,
			maxMembers: 8,
			maxConcurrentChildren: 2,
			allowModel: false
		}
	}
}
function parent(childId: string, input = port) {
	const result = leaf()
	result.steps = [
		{
			id: 'child',
			kind: 'skill',
			label: 'Use child',
			skillArtifactId: childId,
			skillVersion: 2,
			inputs: { source: { kind: 'input', port: 'source' } },
			parameters: {},
			outputs: { source: port }
		}
	] as never
	result.inputs.source = input
	result.outputs.source.from = { kind: 'step', stepId: 'child', port: 'source' } as never
	return result
}
function artifact(scope: string, id: string, payload: Record<string, unknown>): StudioArtifact {
	return {
		artifactId: id,
		scopeId: scope,
		artifactSha256: 'a'.repeat(64),
		typeKey: 'studio.skill',
		typeVersion: 2,
		payload,
		scopeSequence: 1,
		publicationId: randomUUID(),
		committedAt: '2026-09-16T05:00:00Z'
	}
}

describe('shared v2 preview/publication validation', () => {
	test('finds an invalid nested-child binding that the root interface alone cannot reveal', async () => {
		const scope = randomUUID()
		const grandchildId = randomUUID()
		const childId = randomUUID()
		const forged = { ...port, schema: 'fixture:forged@1' }
		const values = new Map<string, StudioArtifact>([
			[grandchildId, artifact(scope, grandchildId, leaf())],
			[childId, artifact(scope, childId, parent(grandchildId, forged))]
		])
		const authority = {
			principal: { subjectId: randomUUID(), kind: 'user' as const, assurance: ['passkey'] },
			access: { tenantId: scope },
			actorAuthorizer: { decide: () => ({ allow: true as const, decisionId: 'yes' }) },
			resolveReadableSkill: async (id: string) => values.get(id)!
		}
		const validator = new StudioV2SkillValidator(scope, new TrustedActorInstallations())
		const result = await validator.validate(parent(childId), authority)
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: 'CHILD_INPUT_MISMATCH',
				path: `children.${childId}.steps.0.inputs.source`
			})
		)
		const preview = await new StudioV2Previewer(validator).preview(parent(childId), authority)
		expect(preview).toMatchObject({
			ok: false,
			mode: 'authoring-contract',
			publishes: false,
			transitiveChildArtifactIds: [childId, grandchildId].sort()
		})
	})

	test('returns parser issues without reading children or mutating anything', async () => {
		const scope = randomUUID()
		let reads = 0
		const preview = await new StudioV2Previewer(
			new StudioV2SkillValidator(scope, new TrustedActorInstallations())
		).preview(
			{ version: 1, name: 'Old' },
			{
				principal: { subjectId: randomUUID(), kind: 'user', assurance: [] },
				access: { tenantId: scope },
				actorAuthorizer: { decide: () => ({ allow: false, decisionId: 'no', reasonCode: 'no' }) },
				resolveReadableSkill: async () => {
					reads++
					throw new Error('unexpected')
				}
			}
		)
		expect(preview.ok).toBe(false)
		expect(preview.issues.length).toBeGreaterThan(0)
		expect(reads).toBe(0)
	})

	test('does not claim runtime readiness for authorable future control steps', async () => {
		const scope = randomUUID()
		const definition: any = leaf()
		definition.steps = [{ id: 'review', kind: 'review', label: 'Review',
			subjectSchema: port.schema, subjects: { source: { kind: 'input', port: 'source' } },
			outputs: {} }]
		definition.outputs = {}
		const authority = {
			principal: { subjectId: randomUUID(), kind: 'user' as const, assurance: [] },
			access: { tenantId: scope },
			actorAuthorizer: { decide: () => ({ allow: true as const, decisionId: 'yes' }) },
			resolveReadableSkill: async () => { throw new Error('unexpected') }
		}
		const preview = await new StudioV2Previewer(
			new StudioV2SkillValidator(scope, new TrustedActorInstallations())
		).preview(definition, authority)
		expect(preview.ok).toBe(false)
		expect(preview.issues).toContainEqual(
			expect.objectContaining({ code: 'RUNTIME_FEATURE_UNAVAILABLE', path: 'definition.steps.0' })
		)
	})

	test('rejects a forged Store type behind an otherwise exact installed schema', async () => {
		const scope = randomUUID()
		const installations = new TrustedActorInstallations()
		await installStudioRuntimeActors(installations)
		const definition: any = leaf()
		definition.inputs.source = {
			...port,
			schema: STUDIO_EMAIL_SCHEMA,
			type: { key: 'forged.email', version: 99 },
			predicate: 'ceo.aven.studio.email(E)'
		}
		definition.outputs = {}
		definition.steps = [
			{
				id: 'brief',
				kind: 'invoke',
				label: 'Create brief',
				capabilityId: STUDIO_EMAIL_BRIEF_CAPABILITY,
				inputs: { email: { kind: 'input', port: 'source' } },
				parameters: {},
				outputs: {
					brief: {
						schema: 'ceo.aven:schema:studio:brief@1',
						type: { key: 'studio.brief', version: 1 },
						predicate: 'ceo.aven.studio.brief(E)',
						role: 'result',
						cardinality: 'one'
					}
				}
			}
		] as never
		const result = await new StudioV2SkillValidator(scope, installations).validate(definition, {
			principal: { subjectId: randomUUID(), kind: 'user', assurance: ['passkey'] },
			access: { tenantId: scope },
			actorAuthorizer: { decide: () => ({ allow: true, decisionId: 'yes' }) },
			resolveReadableSkill: async () => {
				throw new Error('unexpected child read')
			}
		})
		expect(result.issues).toContainEqual(
			expect.objectContaining({ code: 'STORE_TYPE_MISMATCH', path: 'definition.inputs.source' })
		)
	})
})
