import { type PlanRunSecurityContext, parseStudioSkillV2 } from '@avenos/actors'
import { type StudioArtifact, studioPlanDigest } from './studio-artifacts.js'
import { StudioCases } from './studio-cases.js'
import {
	type StudioCaseTransition,
	StudioV2DraftConflict,
	type StudioV2DraftRecord,
	type StudioV2DraftStore
} from './studio-v2-drafts.js'
import { type StudioV2Preview, StudioV2Previewer } from './studio-v2-preview.js'
import type { StudioV2PublicationAuthority, StudioV2SkillPublisher } from './studio-v2-publisher.js'
import { assertExactV2Skill } from './studio-v2-validation.js'

export type StudioV2AuthorityProvider = (
	security: PlanRunSecurityContext
) => StudioV2PublicationAuthority | Promise<StudioV2PublicationAuthority>

export interface StudioV2PublishedDraft {
	draft: StudioV2DraftRecord
	artifact: StudioArtifact
}

export class StudioV2PublicationRace extends Error {
	constructor(
		readonly committedArtifactId: string,
		cause: unknown
	) {
		super('DRAFT_CHANGED_AFTER_PUBLICATION', { cause })
	}
}

/** One v2 authoring path over authenticated CAS drafts and immutable Store publications. */
export class StudioV2Authoring {
	readonly previewer: StudioV2Previewer
	constructor(
		readonly drafts: StudioV2DraftStore,
		readonly publisher: StudioV2SkillPublisher,
		readonly authorityFor: StudioV2AuthorityProvider
	) {
		this.previewer = new StudioV2Previewer(publisher.validator)
	}

	async list(security: PlanRunSecurityContext): Promise<StudioV2DraftRecord[]> {
		this.#assertSecurity(security)
		return await this.drafts.list(security.principal.subjectId)
	}

	async get(id: string, security: PlanRunSecurityContext): Promise<StudioV2DraftRecord> {
		this.#assertSecurity(security)
		return await this.drafts.get(id, security.principal.subjectId)
	}

	async preview(definition: unknown, security: PlanRunSecurityContext): Promise<StudioV2Preview> {
		this.#assertSecurity(security)
		return await this.previewer.preview(definition, await this.authorityFor(security))
	}

	async save(
		input: { id: string; revision: number; definition: unknown; originArtifactId?: string },
		security: PlanRunSecurityContext
	): Promise<StudioV2DraftRecord> {
		this.#assertSecurity(security)
		const subject = security.principal.subjectId
		const definition = parseStudioSkillV2(input.definition)
		if (input.originArtifactId) {
			const authority = await this.authorityFor(security)
			const origin = await authority.resolveReadableSkill(input.originArtifactId)
			assertExactV2Skill(origin, input.originArtifactId, this.publisher.artifacts.scope)
		}
		let transition: StudioCaseTransition | undefined
		if (input.revision > 0) {
			const previous = await this.drafts.get(input.id, subject)
			if (previous.revision !== input.revision) throw new StudioV2DraftConflict('DRAFT_CHANGED')
			if (previous.definition.caseArtifactId !== definition.caseArtifactId) {
				if (previous.publishedArtifactId || !definition.caseArtifactId)
					throw new StudioV2DraftConflict(
						'Keep the Skill’s case origin. Create a variant for a different case.'
					)
				const cases = new StudioCases(this.publisher.artifacts)
				let { record } = await cases.read(definition.caseArtifactId)
				if (record.status !== 'confirmed')
					throw new StudioV2DraftConflict('Confirm the exact case before linking it to this draft.')
				const origin = previous.definition.caseArtifactId
				if (origin) {
					const seen = new Set<string>([definition.caseArtifactId])
					while (record.predecessorArtifactId !== origin) {
						const predecessor = record.predecessorArtifactId
						if (!predecessor || seen.has(predecessor) || seen.size >= 32)
							throw new StudioV2DraftConflict(
								'The confirmed case must retain this draft’s existing case in its provenance. Start a separate draft for an unrelated case.'
							)
						seen.add(predecessor)
						;({ record } = await cases.read(predecessor))
					}
				}
				transition = { from: origin, to: definition.caseArtifactId }
			}
		}
		return await this.drafts.save({ ...input, definition }, subject, transition)
	}

	async publish(
		id: string,
		revision: number,
		security: PlanRunSecurityContext
	): Promise<StudioV2PublishedDraft> {
		this.#assertSecurity(security)
		const subject = security.principal.subjectId
		const draft = await this.drafts.get(id, subject)
		if (draft.revision !== revision)
			throw new StudioV2DraftConflict('DRAFT_CHANGED: refresh and use the current revision.')
		const authority = await this.authorityFor(security)
		if (draft.publishedRevision === revision && draft.publishedArtifactId) {
			const artifact = await authority.resolveReadableSkill(draft.publishedArtifactId)
			assertExactV2Skill(artifact, draft.publishedArtifactId, this.publisher.artifacts.scope)
			return { draft, artifact }
		}
		const artifact = await this.publisher.publish(
			{
				id: draft.id,
				revision: draft.revision,
				definition: draft.definition,
				...(draft.originArtifactId && { originArtifactId: draft.originArtifactId }),
				...(draft.publishedArtifactId && {
					predecessorArtifactId: draft.publishedArtifactId
				})
			},
			authority
		)
		try {
			return {
				draft: await this.drafts.markPublished(
					draft.id,
					subject,
					draft.revision,
					artifact.artifactId
				),
				artifact
			}
		} catch (error) {
			throw new StudioV2PublicationRace(artifact.artifactId, error)
		}
	}

	/** Finish only the mutable head acknowledgement after proving an immutable
	 * Store commit. Never republish, infer success from the current draft, or replace
	 * a newer head. A competing edit is an explicit conflict, not a lost artifact. */
	async recoverPublication(id: string, revision: number, security: PlanRunSecurityContext) {
		this.#assertSecurity(security)
		const authority = await this.authorityFor(security)
		const artifact = await this.publisher.recover(id, revision, authority)
		if (!artifact) return null
		const draft = await this.drafts.get(id, security.principal.subjectId)
		if (draft.revision !== revision) return { artifact, draft, headUpdated: false }
		if (studioPlanDigest(draft.definition) !== studioPlanDigest(artifact.payload))
			throw new Error('STUDIO_PUBLICATION_RESULT_MISMATCH')
		await authority.assertCanPublish()
		try {
			return {
				artifact,
				draft: await this.drafts.markPublished(
					id,
					security.principal.subjectId,
					revision,
					artifact.artifactId
				),
				headUpdated: true
			}
		} catch (error) {
			if (
				!(error instanceof StudioV2DraftConflict) ||
				error.message !== 'DRAFT_CHANGED_AFTER_PUBLICATION'
			)
				throw error
			return {
				artifact,
				draft: await this.drafts.get(id, security.principal.subjectId),
				headUpdated: false
			}
		}
	}

	#assertSecurity(security: PlanRunSecurityContext): void {
		if (
			security.principal.kind !== 'user' ||
			security.access.tenantId !== this.publisher.artifacts.scope
		)
			throw new Error('STUDIO_AUTHORING_UNAUTHORIZED')
	}
}
