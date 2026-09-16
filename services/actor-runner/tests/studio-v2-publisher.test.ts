import { randomUUID } from 'node:crypto'
import { TrustedActorInstallations } from '@avenos/actors'
import type { ArtifactStoreClient } from '@avenos/artifact-store'
import { describe, expect, test, vi } from 'vitest'
import { type StudioArtifact, StudioArtifacts } from '../src/studio-artifacts'
import {
	STUDIO_SKILL_V2_TYPE_DIGEST,
	type StudioV2PublicationAuthority,
	StudioV2SkillPublisher
} from '../src/studio-v2-publisher'

const port = {
	schema: 'fixture:document@1',
	type: { key: 'fixture.document', version: 1 },
	predicate: 'fixture.document(X)',
	role: 'source',
	cardinality: 'one'
}
const policy = {
	maxInvocations: 8,
	maxDepth: 3,
	maxMembers: 8,
	maxConcurrentChildren: 2,
	allowModel: false
}
function skill() {
	return {
		version: 2,
		name: 'Reuse document',
		inputs: { source: port },
		parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
		steps: [],
		outputs: { source: { ...port, from: { kind: 'input', port: 'source' } } },
		policy
	}
}

function fixture() {
	const scope = randomUUID()
	const subject = randomUUID()
	const childId = randomUUID()
	const child: StudioArtifact = {
		artifactId: childId,
		scopeId: scope,
		artifactSha256: '0'.repeat(64),
		typeKey: 'studio.skill',
		typeVersion: 2,
		payload: skill(),
		scopeSequence: 1,
		publicationId: randomUUID(),
		committedAt: new Date().toISOString()
	}
	const records = new Map<string, StudioArtifact>([[childId, child]])
	const publications = new Map<string, { intent: unknown; artifact: StudioArtifact }>()
	let installedDigest = STUDIO_SKILL_V2_TYPE_DIGEST
	const publish = vi.fn(
		async (_scope: string, id: string, _epoch: string, submission: { intent: any }) => {
			const prior = publications.get(id)
			if (prior) {
				if (JSON.stringify(prior.intent) !== JSON.stringify(submission.intent))
					throw new Error('PUBLICATION_CONFLICT')
				return { artifacts: [{ artifactId: prior.artifact.artifactId }], replayed: true }
			}
			const artifact: StudioArtifact = {
				artifactId: randomUUID(),
				scopeId: scope,
				artifactSha256: '1'.repeat(64),
				typeKey: 'studio.skill',
				typeVersion: 2,
				payload: submission.intent.artifacts[0].payload,
				scopeSequence: 2,
				publicationId: id,
				committedAt: new Date().toISOString()
			}
			records.set(artifact.artifactId, artifact)
			publications.set(id, { intent: submission.intent, artifact })
			return { artifacts: [{ artifactId: artifact.artifactId }], replayed: false }
		}
	)
	const client = {
		context: async () => ({ storeEpoch: randomUUID() }),
		type: async () => ({
			typeKey: 'studio.skill',
			version: 2,
			typeDefinitionSha256: installedDigest
		}),
		artifact: async (_scope: string, id: string) => {
			const found = records.get(id)
			if (!found) throw new Error('RESOURCE_UNAVAILABLE')
			return { ...found, scopeId: scope }
		},
		publish
	} as unknown as ArtifactStoreClient
	const artifacts = new StudioArtifacts(client, scope)
	const publisher = new StudioV2SkillPublisher(artifacts, new TrustedActorInstallations())
	const canPublish = vi.fn(async () => {})
	const resolveReadableSkill = vi.fn(async (id: string) => artifacts.get(id))
	const authority: StudioV2PublicationAuthority = {
		principal: { subjectId: subject, kind: 'user', assurance: ['passkey'] },
		access: { tenantId: scope },
		actorAuthorizer: { decide: () => ({ allow: false, decisionId: 'none', reasonCode: 'none' }) },
		assertCanPublish: canPublish,
		resolveReadableSkill
	}
	const parent = skill()
	parent.steps = [
		{
			id: 'reuse',
			kind: 'skill',
			label: 'Reuse saved document skill',
			skillArtifactId: childId,
			skillVersion: 2,
			inputs: { source: { kind: 'input', port: 'source' } },
			parameters: {},
			outputs: { source: port }
		}
	] as never
	parent.outputs.source.from = { kind: 'step', stepId: 'reuse', port: 'source' } as never
	const draft = { id: randomUUID(), revision: 1, definition: parent }
	return {
		scope,
		childId,
		records,
		publications,
		publish,
		publisher,
		authority,
		resolveReadableSkill,
		canPublish,
		draft,
		setTypeDigest: (value: string) => {
			installedDigest = value
		}
	}
}

describe('v2 Skill artifact publication seam', () => {
	test('publishes exact child references and causal inputs, and replays the same draft', async () => {
		const f = fixture()
		const first = await f.publisher.publish(f.draft, f.authority)
		const second = await f.publisher.publish(f.draft, f.authority)
		expect(first.artifactId).toBe(second.artifactId)
		expect(first.typeVersion).toBe(2)
		expect(f.canPublish).toHaveBeenCalledTimes(2)
		expect(f.resolveReadableSkill).toHaveBeenCalledWith(f.childId)
		const intent = [...f.publications.values()][0]!.intent as any
		expect(intent.run.inputs).toEqual([{ role: 'child', ordinal: 0, artifactId: f.childId }])
		expect(intent.artifacts[0].references).toEqual([
			{
				role: 'child',
				ordinal: 0,
				target: { kind: 'existing', artifactId: f.childId },
				attributes: {}
			}
		])
		expect(intent.artifacts[0].blob).toBeNull()
		expect(intent.evidence).toEqual([])
		expect(f.publish).toHaveBeenCalledTimes(2)
	})

	test('preserves predecessor as a producer input, not an invalid structural reference', async () => {
		const f = fixture()
		const previous = await f.publisher.publish(f.draft, f.authority)
		const next = { ...f.draft, revision: 2, predecessorArtifactId: previous.artifactId }
		await f.publisher.publish(next, f.authority)
		const intent = [...f.publications.values()][1]!.intent as any
		expect(intent.run.inputs).toContainEqual({
			role: 'predecessor',
			ordinal: 0,
			artifactId: previous.artifactId
		})
		expect(intent.artifacts[0].references.every((ref: any) => ref.role === 'child')).toBe(true)
	})

	test('blocks missing exact type registration and unreadable child before Store write', async () => {
		const f = fixture()
		f.setTypeDigest('f'.repeat(64))
		await expect(f.publisher.publish(f.draft, f.authority)).rejects.toThrow(
			'CATALOG_NOT_PROVISIONED'
		)
		expect(f.publish).not.toHaveBeenCalled()
		f.setTypeDigest(STUDIO_SKILL_V2_TYPE_DIGEST)
		f.authority.resolveReadableSkill = async () => {
			throw new Error('SKILL_READ_DENIED')
		}
		await expect(f.publisher.publish(f.draft, f.authority)).rejects.toThrow('SKILL_READ_DENIED')
		expect(f.publish).not.toHaveBeenCalled()
	})

	test('blocks a forged child input type and a changed definition under one revision', async () => {
		const f = fixture()
		const wrong = structuredClone(f.draft)
		wrong.definition.inputs.source = {
			...wrong.definition.inputs.source,
			schema: 'fixture:forged@1'
		}
		await expect(f.publisher.publish(wrong, f.authority)).rejects.toThrow(
			'Bound artifact port differs from the exact child input contract'
		)
		expect(f.publish).not.toHaveBeenCalled()
		await f.publisher.publish(f.draft, f.authority)
		const changed = structuredClone(f.draft)
		changed.definition.name = 'Different saved skill'
		await expect(f.publisher.publish(changed, f.authority)).rejects.toThrow('PUBLICATION_CONFLICT')
	})

	test('does not publish an uninstalled Actor call or a wrong customer scope', async () => {
		const f = fixture()
		const invocation = structuredClone(f.draft)
		invocation.definition.steps = [
			{
				id: 'inspect',
				kind: 'invoke',
				label: 'Inspect',
				capabilityId: 'ceo.aven:capability:missing.inspect:run@1',
				inputs: { source: { kind: 'input', port: 'source' } },
				parameters: {},
				outputs: { source: port }
			}
		] as never
		invocation.definition.outputs.source.from = {
			kind: 'step',
			stepId: 'inspect',
			port: 'source'
		} as never
		await expect(f.publisher.publish(invocation, f.authority)).rejects.toThrow(
			'Installed capability is unavailable'
		)
		expect(f.publish).not.toHaveBeenCalled()
		f.authority.access.tenantId = randomUUID()
		await expect(f.publisher.publish(f.draft, f.authority)).rejects.toThrow(
			'STUDIO_PUBLICATION_UNAUTHORIZED'
		)
		expect(f.publish).not.toHaveBeenCalled()
	})
})
