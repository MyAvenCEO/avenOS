import type { PlanRunSecurityContext } from '@avenos/actors'
import type { StudioArtifact } from './studio-artifacts.js'
import type { StudioV2DraftRecord, StudioV2DraftStore } from './studio-v2-drafts.js'
import {
	type StudioV2PublicationAuthority,
	type StudioV2SkillPublisher
} from './studio-v2-publisher.js'
import { StudioV2Previewer, type StudioV2Preview } from './studio-v2-preview.js'
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
		input: { id: string; revision: number; definition: unknown },
		security: PlanRunSecurityContext
	): Promise<StudioV2DraftRecord> {
		this.#assertSecurity(security)
		return await this.drafts.save(input, security.principal.subjectId)
	}

	async publish(
		id: string,
		revision: number,
		security: PlanRunSecurityContext
	): Promise<StudioV2PublishedDraft> {
		this.#assertSecurity(security)
		const subject = security.principal.subjectId
		const draft = await this.drafts.get(id, subject)
		if (draft.revision !== revision) throw new Error('DRAFT_CHANGED')
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

	#assertSecurity(security: PlanRunSecurityContext): void {
		if (
			security.principal.kind !== 'user' ||
			security.access.tenantId !== this.publisher.artifacts.scope
		)
			throw new Error('STUDIO_AUTHORING_UNAUTHORIZED')
	}
}
