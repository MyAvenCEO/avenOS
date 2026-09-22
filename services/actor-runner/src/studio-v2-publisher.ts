import {
	parseStudioSkillV2,
	STUDIO_SKILL_ARTIFACT_VERSION,
	StudioSkillV2Error,
	studioSkillChildReferences,
	type TrustedActorInstallations
} from '@avenos/actors'
import { StudioCaseError } from '@avenos/actors/studio/case'
import { ArtifactStoreProblem, clientRunIdentity } from '@avenos/artifact-store'
import {
	type StudioArtifact,
	type StudioArtifacts,
	studioObject,
	studioPlanDigest
} from './studio-artifacts.js'
import { StudioCases } from './studio-cases.js'
import {
	assertExactV2Skill,
	StudioV2SkillValidator,
	type StudioV2ValidationAuthority
} from './studio-v2-validation.js'

// Source-controlled conformance/fixtures/protocol/studio.skill.v3.json, using
// artifact-store/type-definition/v1\0 + canonical Artifact JSON.
export const STUDIO_SKILL_V2_TYPE_DIGEST =
	'fcd28e1714f2709841484a62519917f2fe3d1076f64e9dc471614790f92db2b7'

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
	originArtifactId?: string
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

	/** Read the immutable outcome for an exact requested draft revision. Absence is
	 * not proof that an in-flight publication failed, and never permits redispatch. */
	async recover(
		id: string,
		revision: number,
		authority: StudioV2PublicationAuthority
	): Promise<StudioArtifact | null> {
		if (authority.principal.kind !== 'user' || authority.access.tenantId !== this.artifacts.scope)
			throw new Error('STUDIO_PUBLICATION_UNAUTHORIZED')
		const publicationId = await this.#identity(id, revision, authority.principal.subjectId)
		const artifacts = await this.artifacts.lookup(publicationId)
		if (!artifacts) return null
		if (artifacts.length !== 1) throw new Error('STUDIO_PUBLICATION_RECEIPT_INVALID')
		const artifact = artifacts[0]!
		assertExactV2Skill(artifact, artifact.artifactId, this.artifacts.scope)
		parseStudioSkillV2(artifact.payload)
		if (artifact.publicationId !== publicationId)
			throw new Error('STUDIO_PUBLICATION_RESULT_MISMATCH')
		return artifact
	}

	#identity(id: string, revision: number, subject: string) {
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
			!Number.isSafeInteger(revision) ||
			revision < 1
		)
			throw new Error('STUDIO_PUBLICATION_IDENTITY_INVALID')
		return clientRunIdentity(
			JSON.stringify(['studio-skill-v2', this.artifacts.scope, subject, id, revision])
		)
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
		if (definition.caseArtifactId) {
			const { record } = await new StudioCases(this.artifacts).read(definition.caseArtifactId)
			if (record.status !== 'confirmed' || record.case.steps.some((s) => s.kind === 'ideal'))
				throw new StudioCaseError(
					'Confirm the case and replace its ideal steps before publishing an executable Skill.'
				)
		}
		let predecessor: StudioArtifact | undefined
		let origin: StudioArtifact | undefined
		if (draft.originArtifactId) {
			origin = await authority.resolveReadableSkill(draft.originArtifactId)
			assertExactV2Skill(origin, draft.originArtifactId, this.artifacts.scope)
		}
		if (draft.predecessorArtifactId) {
			predecessor = await authority.resolveReadableSkill(draft.predecessorArtifactId)
			assertExactV2Skill(predecessor, draft.predecessorArtifactId, this.artifacts.scope)
		}
		const publicationId = await this.#identity(
			draft.id,
			draft.revision,
			authority.principal.subjectId
		)
		const roles = new Map<string, number>()
		const inputs = [
			...(origin ? [{ role: 'origin', artifactId: origin.artifactId }] : []),
			...(definition.caseArtifactId
				? [{ role: 'case', artifactId: definition.caseArtifactId }]
				: []),
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
		if (definition.caseArtifactId)
			references.push({
				role: 'case',
				ordinal: 0,
				target: { kind: 'existing', artifactId: definition.caseArtifactId },
				attributes: {}
			})
		// Origin and predecessor are publication inputs, not Skill payload references.
		// This retains their immutable provenance without inventing reference roles
		// outside the registered Skill type's case/child contract.
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
							typeVersion: STUDIO_SKILL_ARTIFACT_VERSION,
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
			registered = studioObject(
				await this.artifacts.client.type('studio.skill', STUDIO_SKILL_ARTIFACT_VERSION)
			)
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
			registered.version !== STUDIO_SKILL_ARTIFACT_VERSION ||
			registered.typeDefinitionSha256 !== STUDIO_SKILL_V2_TYPE_DIGEST
		)
			throw new Error('CATALOG_NOT_PROVISIONED')
	}
}
