import { expect, test } from 'bun:test'
import type { EnvelopeInput, Persistence, SkillRecord, SkillRecordInput } from '@jaensen/persistence-sqlite'

import { bootstrapSkills } from '../src/index'

test('stores loaded skills in persistence', async () => {
	const persistence = new BootstrapPersistence()
	const now = new Date('2026-05-12T00:00:00.000Z')
	const skills = [
		{
			id: 'memory',
			path: 'memory/SKILL.md',
			description: 'Memory skill',
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
			frontmatter: { id: 'memory', description: 'Memory skill' },
			body: '# Memory',
			bodyHash: 'hash-memory',
			loadedAt: now.toISOString()
		},
		{
			id: 'extract',
			path: 'extract/SKILL.md',
			description: 'Extract skill',
			frontmatter: { id: 'extract', description: 'Extract skill' },
			body: '# Extract',
			bodyHash: 'hash-extract',
			loadedAt: now.toISOString()
		}
	]

	await bootstrapSkills({ persistence, skills, now })

	expect(persistence.upsertedActors).toEqual([
		{
			id: 'skills/memory',
			kind: 'skill-supervisor',
			state: {
				skillId: 'memory',
				workers: {},
				bootstrappedAt: '2026-05-12T00:00:00.000Z'
			}
		},
		{
			id: 'skills/extract',
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
		fromActor: 'skills',
		toActor: 'skills/memory',
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
}