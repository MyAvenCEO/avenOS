import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { SkillDefinition } from '@jaensen/skills'

import {
	FlueBrainModelError,
	createFlueSkillSupervisorBrain
} from '../src/index'

const skill: SkillDefinition = {
	id: 'memory',
	path: 'memory/SKILL.md',
	description: 'Memory skill',
	frontmatter: { id: 'memory', description: 'Memory skill' },
	body: '# Memory\nRemember important facts.',
	bodyHash: 'hash-memory',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('supervisor uses stable session name', async () => {
	const calls: string[] = []
	const brain = createFlueSkillSupervisorBrain({
		harness: {
			async session(name) {
				calls.push(name)
				return {
					async prompt() {
						return { state: { skillId: 'memory', workers: {}, calls: {} } }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		},
		workspaceRoot: '/workspace'
	})

	const result = await brain.decide({
		skill,
		actorState: { skillId: 'memory', workers: {} },
		envelope: makeEnvelopeRecord()
	})

	expect(calls).toEqual(['actor/skill/memory'])
	expect(result.state).toEqual({ skillId: 'memory', workers: {}, calls: {} })
})

test('model errors propagate clearly', async () => {
	const brain = createFlueSkillSupervisorBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						throw new Error('boom from flue')
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		},
		workspaceRoot: '/workspace',
		model: 'gpt-test'
	})

	await expect(
		brain.decide({
			skill,
			actorState: { skillId: 'memory', workers: {} },
			envelope: makeEnvelopeRecord()
		})
	).rejects.toThrow(FlueBrainModelError)

	await expect(
		brain.decide({
			skill,
			actorState: { skillId: 'memory', workers: {} },
			envelope: makeEnvelopeRecord()
		})
	).rejects.toThrow('Flue supervisor decision failed for skill memory: boom from flue')
})

test('supervisor accepts flue responses wrapped in data', async () => {
	const brain = createFlueSkillSupervisorBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { data: { state: { skillId: 'memory', workers: {}, calls: {} } } }
					},
					async task() {
						throw new Error('unexpected task')
					},
					async shell() {
						throw new Error('unexpected shell')
					}
				}
			}
		},
		workspaceRoot: '/workspace'
	})

	await expect(
		brain.decide({ skill, actorState: { skillId: 'memory', workers: {}, calls: {} }, envelope: makeEnvelopeRecord() })
	).resolves.toMatchObject({ state: { skillId: 'memory', workers: {}, calls: {} } })
})

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'intent/default',
		toActor: 'skill/memory',
		type: 'memory.remember',
		correlationId: 'corr-1',
		causationId: null,
		payload: {},
		status: 'queued',
		availableAt: '2026-05-12T00:00:00.000Z',
		attempts: 0,
		maxAttempts: 25,
		lockedBy: null,
		lockedUntil: null,
		lastError: null,
		createdAt: '2026-05-12T00:00:00.000Z',
		updatedAt: '2026-05-12T00:00:00.000Z',
		...overrides
	}
}