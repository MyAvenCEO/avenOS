import { randomUUID } from 'node:crypto'
import type { PlanRunSecurityContext } from '@avenos/actors'
import { describe, expect, test, vi } from 'vitest'
import type { StudioArtifact } from '../src/studio-artifacts'
import { StudioV2Authoring, StudioV2PublicationRace } from '../src/studio-v2-authoring'
import type { StudioV2DraftRecord, StudioV2DraftStore } from '../src/studio-v2-drafts'
import type { StudioV2SkillPublisher } from '../src/studio-v2-publisher'

function fixture() {
	const scope = randomUUID()
	const subject = randomUUID()
	const draft: StudioV2DraftRecord = {
		id: randomUUID(),
		subjectId: subject,
		revision: 2,
		definition: {} as never,
		publishedArtifactId: randomUUID(),
		publishedRevision: 1,
		updatedAt: '2026-09-16T05:00:00Z'
	}
	const artifact = (id: string = randomUUID()): StudioArtifact => ({
		artifactId: id,
		scopeId: scope,
		artifactSha256: '0'.repeat(64),
		typeKey: 'studio.skill',
		typeVersion: 2,
		payload: {},
		scopeSequence: 1,
		publicationId: randomUUID(),
		committedAt: '2026-09-16T05:00:00Z'
	})
	const saved = new Map<string, StudioArtifact>()
	saved.set(draft.publishedArtifactId!, artifact(draft.publishedArtifactId!))
	const store: StudioV2DraftStore = {
		list: vi.fn(async () => [draft]),
		get: vi.fn(async () => draft),
		save: vi.fn(async (input) => ({ ...draft, definition: input.definition as never })),
		markPublished: vi.fn(async (_id, _subject, revision, artifactId) => ({
			...draft,
			revision,
			publishedRevision: revision,
			publishedArtifactId: artifactId
		}))
	}
	const publish = vi.fn(async () => {
		const result = artifact()
		saved.set(result.artifactId, result)
		return result
	})
	const validate = vi.fn(async (definition: unknown) => ({
		definition: definition as never,
		children: new Map(),
		childArtifacts: new Map(),
		issues: []
	}))
	const publisher = {
		artifacts: { scope },
		validator: { validate },
		publish
	} as unknown as StudioV2SkillPublisher
	const assertCanPublish = vi.fn(async () => {})
	const authority = {
		principal: { subjectId: subject, kind: 'user' as const, assurance: ['passkey'] },
		access: { tenantId: scope },
		actorAuthorizer: {
			decide: () => ({ allow: false as const, decisionId: 'none', reasonCode: 'none' })
		},
		assertCanPublish,
		resolveReadableSkill: vi.fn(async (id: string) => saved.get(id)!)
	}
	const authorityFor = vi.fn(async () => authority)
	const security: PlanRunSecurityContext = {
		principal: authority.principal,
		access: authority.access,
		establishedBy: 'test',
		authorizedAt: '2026-09-16T05:00:00Z'
	}
	return {
		scope,
		subject,
		draft,
		store,
		publish,
		validate,
		authority,
		authorityFor,
		security,
		authoring: new StudioV2Authoring(store, publisher, authorityFor)
	}
}

describe('v2 Studio authoring orchestration', () => {
	test('lists, reads and previews only through the authenticated subject boundary', async () => {
		const f = fixture()
		expect(await f.authoring.list(f.security)).toEqual([f.draft])
		expect(f.store.list).toHaveBeenCalledWith(f.subject)
		expect(await f.authoring.get(f.draft.id, f.security)).toBe(f.draft)
		expect(f.store.get).toHaveBeenCalledWith(f.draft.id, f.subject)
		const preview = await f.authoring.preview({}, f.security)
		expect(preview).toMatchObject({ ok: true, mode: 'authoring-contract', publishes: false })
		expect(f.validate).toHaveBeenCalledWith({}, f.authority)
	})

	test('publishes a CAS draft with its prior immutable head as predecessor', async () => {
		const f = fixture()
		const result = await f.authoring.publish(f.draft.id, 2, f.security)
		expect(f.publish).toHaveBeenCalledWith(
			expect.objectContaining({
				id: f.draft.id,
				revision: 2,
				predecessorArtifactId: f.draft.publishedArtifactId
			}),
			f.authority
		)
		expect(f.store.markPublished).toHaveBeenCalledWith(
			f.draft.id,
			f.subject,
			2,
			result.artifact.artifactId
		)
		expect(result.draft.publishedRevision).toBe(2)
	})

	test('replays an already published revision without another Store write', async () => {
		const f = fixture()
		f.draft.publishedRevision = 2
		const result = await f.authoring.publish(f.draft.id, 2, f.security)
		expect(result.artifact.artifactId).toBe(f.draft.publishedArtifactId)
		expect(f.publish).not.toHaveBeenCalled()
		expect(f.store.markPublished).not.toHaveBeenCalled()
	})

	test('returns the committed artifact identity when the draft advances after Store commit', async () => {
		const f = fixture()
		f.store.markPublished = vi.fn(async () => {
			throw new Error('DRAFT_CHANGED')
		})
		try {
			await f.authoring.publish(f.draft.id, 2, f.security)
			throw new Error('expected publication race')
		} catch (error) {
			expect(error).toBeInstanceOf(StudioV2PublicationRace)
			expect((error as StudioV2PublicationRace).committedArtifactId).toMatch(/^[0-9a-f-]{36}$/)
		}
	})

	test('rejects a wrong customer before draft or publication access', async () => {
		const f = fixture()
		const wrong = { ...f.security, access: { tenantId: randomUUID() } }
		await expect(
			f.authoring.save({ id: randomUUID(), revision: 0, definition: {} }, wrong)
		).rejects.toThrow('STUDIO_AUTHORING_UNAUTHORIZED')
		expect(f.store.save).not.toHaveBeenCalled()
		await expect(f.authoring.publish(f.draft.id, 2, wrong)).rejects.toThrow(
			'STUDIO_AUTHORING_UNAUTHORIZED'
		)
		expect(f.store.get).not.toHaveBeenCalled()
	})
})
