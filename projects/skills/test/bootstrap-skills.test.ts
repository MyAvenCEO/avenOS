import { expect, test } from 'bun:test'
import {
	SKILLS_ACTOR_ID,
	createSkillActorId,
	type EnvelopeInput,
	type Persistence,
	type SkillRecord,
	type SkillRecordInput
} from '@jaensen/persistence-sqlite'

import { bootstrapSkills } from '../src/index'

test('stores loaded skills in persistence', async () => {
	const persistence = new BootstrapPersistence()
	const now = new Date('2026-05-12T00:00:00.000Z')
	const skills = [
		{
			id: 'memory',
			path: 'memory/SKILL.md',
			description: 'Memory skill',
			directActors: [],
			frontmatter: { id: 'memory', description: 'Memory skill' },
			body: '# Memory',
			bodyHash: 'hash-memory',
			loadedAt: now.toISOString()
		}
	]

	await bootstrapSkills({ persistence, skills, now })

	expect(persistence.replacedSkills).toEqual({ skills, now })
})

test('bootstraps one skill supervisor actor per skill', async () => {
	const persistence = new BootstrapPersistence()
	const now = new Date('2026-05-12T00:00:00.000Z')
	const skills = [
		{
			id: 'memory',
			path: 'memory/SKILL.md',
			description: 'Memory skill',
			directActors: [],
			frontmatter: { id: 'memory', description: 'Memory skill' },
			body: '# Memory',
			bodyHash: 'hash-memory',
			loadedAt: now.toISOString()
		},
		{
			id: 'extract',
			path: 'extract/SKILL.md',
			description: 'Extract skill',
			directActors: [],
			frontmatter: { id: 'extract', description: 'Extract skill' },
			body: '# Extract',
			bodyHash: 'hash-extract',
			loadedAt: now.toISOString()
		}
	]

	await bootstrapSkills({ persistence, skills, now })

	expect(persistence.upsertedActors).toEqual([
		{
			id: createSkillActorId('memory'),
			kind: 'skill-supervisor',
			state: {
				skillId: 'memory',
				workers: {},
				bootstrappedAt: '2026-05-12T00:00:00.000Z'
			}
		},
		{
			id: createSkillActorId('extract'),
			kind: 'skill-supervisor',
			state: {
				skillId: 'extract',
				workers: {},
				bootstrappedAt: '2026-05-12T00:00:00.000Z'
			}
		}
	])
	expect(persistence.enqueued).toHaveLength(2)
	expect(persistence.enqueued[0]).toMatchObject({
		fromActor: SKILLS_ACTOR_ID,
		toActor: createSkillActorId('memory'),
		type: 'skill.bootstrap',
		payload: { skillId: 'memory' }
	})
})

class BootstrapPersistence implements Persistence {
	replacedSkills: { skills: SkillRecordInput[]; now: Date } | null = null
	upsertedActors: Array<{ id: string; kind: string; state?: unknown }> = []
	enqueued: EnvelopeInput[] = []

	async migrate(): Promise<void> {}
	async upsertActor(input: { id: string; kind: string; status?: 'active' | 'stopped' | 'failed'; state?: unknown }): Promise<void> {
		this.upsertedActors.push(input)
	}
	async ensureActorExists(input: { id: string; kind: string; status?: 'active' | 'stopped' | 'failed'; state?: unknown }): Promise<void> {
		this.upsertedActors.push(input)
	}
	async getActor(): Promise<null> {
		return null
	}
	async enqueue(envelope: EnvelopeInput): Promise<void> {
		this.enqueued.push(envelope)
	}
	async claimNext(): Promise<null> {
		return null
	}
	async commitActivation(): Promise<void> {}
	async appendContext(): Promise<number> { return 0 }
	async failActivation(): Promise<void> {}
	async releaseExpiredLocks(): Promise<number> {
		return 0
	}
	async replaceSkills(skills: SkillRecordInput[], now: Date): Promise<void> {
		this.replacedSkills = { skills, now }
	}
	async listSkills(): Promise<SkillRecord[]> {
		return []
	}
	async listContextItems(): Promise<[]> { return [] }
	async getContextSnapshotSeq(): Promise<number> { return 0 }
	async appendEvents(): Promise<number[]> { return [] }
	async listEvents(): Promise<[]> { return [] }
	async listActorHierarchy(): Promise<[]> { return [] }
	async listActorBranchLogs(): Promise<[]> { return [] }
	async listCommunicationTree(): Promise<[]> { return [] }
	async summarizeCommunicationTree() {
		return { rootCount: 0, envelopeCount: 0, logCount: 0, actorCount: 0, actorIoCount: 0, errorCount: 0, startedAt: null, endedAt: null }
	}
}