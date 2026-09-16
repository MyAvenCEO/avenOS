import {
	parseStudioSkillV2,
	studioSkillChildReferences,
	StudioSkillV2Error,
	type TrustedActorInstallations
} from '@avenos/actors'
import { ArtifactStoreProblem, clientRunIdentity } from '@avenos/artifact-store'
import {
	type StudioArtifact,
	type StudioArtifacts,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'
import {
	assertExactV2Skill,
	StudioV2SkillValidator,
	type StudioV2ValidationAuthority
} from './studio-v2-validation.js'

// Source-controlled conformance/fixtures/protocol/studio.skill.v2.json, using
// artifact-store/type-definition/v1\0 + canonical Artifact JSON.
export const STUDIO_SKILL_V2_TYPE_DIGEST =
	'19eceedc0b9ed8e5694d39c14d559340ad835ec42dc35d6cd426d54dc5568512'

/** Passed only by the authenticated host; caller JSON cannot construct this port. */
export interface StudioV2PublicationAuthority extends StudioV2ValidationAuthority {
	assertCanPublish(): Promise<void>
}

/** Immutable, CAS-read draft identity. The public request supplies neither definition nor head. */
export interface StudioV2PublicationDraft {
	id: string
	revision: number
	definition: unknown
	predecessorArtifactId?: string
}

/** V2-only artifact authoring boundary. No old Skill conversion or reader. */
export class StudioV2SkillPublisher {
	readonly validator: StudioV2SkillValidator
	constructor(
		readonly artifacts: StudioArtifacts,
		readonly installations: TrustedActorInstallations
	) {
		this.validator = new StudioV2SkillValidator(artifacts.scope, installations)
	}

	async publish(
		draft: StudioV2PublicationDraft,
		authority: StudioV2PublicationAuthority
	): Promise<StudioArtifact> {
		await authority.assertCanPublish()
		if (
			authority.principal.kind !== 'user' ||
			authority.access.tenantId !== this.artifacts.scope ||
			!Number.isSafeInteger(draft.revision) ||
			draft.revision < 1
		)
			throw new Error('STUDIO_PUBLICATION_UNAUTHORIZED')
		await this.#assertTypeProvisioned()
		const admitted = await this.validator.validate(draft.definition, authority)
		if (admitted.issues.length) throw new StudioSkillV2Error(admitted.issues)
		const { definition, childArtifacts } = admitted
		let predecessor: StudioArtifact | undefined
		if (draft.predecessorArtifactId) {
			predecessor = await authority.resolveReadableSkill(draft.predecessorArtifactId)
			assertExactV2Skill(predecessor, draft.predecessorArtifactId, this.artifacts.scope)
		}
		const publicationId = await clientRunIdentity(
			JSON.stringify([
				'studio-skill-v2',
				this.artifacts.scope,
				authority.principal.subjectId,
				draft.id,
				draft.revision
			])
		)
		const roles = new Map<string, number>()
		const inputs = [
			...(predecessor ? [{ role: 'predecessor', artifactId: predecessor.artifactId }] : []),
			...[...childArtifacts.values()].map((item) => ({
				role: 'child',
				artifactId: item.artifactId
			}))
		].map((item) => {
			const ordinal = roles.get(item.role) ?? 0
			roles.set(item.role, ordinal + 1)
			return { ...item, ordinal }
		})
		const references = studioSkillChildReferences(definition).map((id, ordinal) => ({
			role: 'child',
			ordinal,
			target: { kind: 'existing', artifactId: id },
			attributes: {}
		}))
		const context = studioObject(await this.artifacts.client.context())
		if (typeof context.storeEpoch !== 'string') throw new Error('STORE_EPOCH_UNAVAILABLE')
		const response = studioObject(
			await this.artifacts.client.publish(this.artifacts.scope, publicationId, context.storeEpoch, {
				intent: {
					commandVersion: 1,
					publicationId,
					scopeId: this.artifacts.scope,
					kind: 'run',
					run: {
						procedureKey: 'studio.author',
						procedureVersion: '2',
						initiator: { kind: 'user', id: `user:${authority.principal.subjectId}` },
						executor: { kind: 'service', id: 'studio' },
						inputs,
						parameters: { draftId: draft.id, revision: draft.revision },
						implementation: { adapter: 'studio-v2-author' },
						receipt: { outcome: 'succeeded' }
					},
					artifacts: [
						{
							localKey: 'skill',
							typeKey: 'studio.skill',
							typeVersion: 2,
							payload: definition,
							blob: null,
							output: { role: 'result', ordinal: 0 },
							references
						}
					],
					evidence: []
				},
				blobAuthorities: {}
			} as unknown as Parameters<typeof this.artifacts.client.publish>[3])
		)
		const committed = response.artifacts as Array<{ artifactId: string }> | undefined
		if (
			!Array.isArray(committed) ||
			committed.length !== 1 ||
			typeof committed[0]?.artifactId !== 'string'
		)
			throw new Error('STUDIO_PUBLICATION_RECEIPT_INVALID')
		const artifact = await this.artifacts.get(committed[0].artifactId)
		assertExactV2Skill(artifact, artifact.artifactId, this.artifacts.scope)
		if (
			artifact.publicationId !== publicationId ||
			studioPlanDigest(parseStudioSkillV2(artifact.payload)) !== studioPlanDigest(definition)
		)
			throw new Error('STUDIO_PUBLICATION_RESULT_MISMATCH')
		return artifact
	}

	async #assertTypeProvisioned(): Promise<void> {
		let registered: Record<string, unknown>
		try {
			registered = studioObject(await this.artifacts.client.type('studio.skill', 2))
		} catch (error) {
			if (
				error instanceof ArtifactStoreProblem &&
				error.status === 404 &&
				error.code === 'RESOURCE_UNAVAILABLE'
			)
				throw new Error('CATALOG_NOT_PROVISIONED')
			throw error
		}
		if (
			registered.typeKey !== 'studio.skill' ||
			registered.version !== 2 ||
			registered.typeDefinitionSha256 !== STUDIO_SKILL_V2_TYPE_DIGEST
		)
			throw new Error('CATALOG_NOT_PROVISIONED')
	}
}
