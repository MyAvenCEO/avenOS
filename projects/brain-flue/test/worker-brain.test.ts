import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from 'bun:test'
import type { EnvelopeRecord } from '@jaensen/persistence-sqlite'
import type { SkillDefinition } from '@jaensen/skills'

import { createFlueSkillWorkerBrain } from '../src/index'

const baseSkill: SkillDefinition = {
	id: 'memory',
	path: 'memory/SKILL.md',
	description: 'Memory skill',
	directActors: [],
	frontmatter: { id: 'memory', description: 'Memory skill' },
	body: '# Memory\nRemember important facts.',
	bodyHash: 'hash-memory',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('durable worker uses stable worker session', async () => {
	const calls: string[] = []
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session(name) {
				calls.push(name)
				return {
					async prompt() {
						return { state: { persisted: true }, completed: true }
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

	const result = await brain.run({
		skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'durable' } },
		workerId: 'topic-jaensen-architecture',
		actorState: {},
		envelope: makeEnvelopeRecord()
	})

	expect(calls).toEqual(['actor/skill-worker/memory/topic-jaensen-architecture'])
	expect(result.state).toEqual({ persisted: true })
})

test('ephemeral worker uses task()', async () => {
	const calls: Array<{ type: string; value: string }> = []
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session(name) {
				calls.push({ type: 'session', value: name })
				return {
					async prompt() {
						throw new Error('unexpected prompt')
					},
					async task() {
						calls.push({ type: 'task', value: 'called' })
						return { state: { temp: true } }
					},
					async shell() {
						return { stdout: '', stderr: '', exitCode: 0 }
					}
				}
			}
		},
		workspaceRoot: '/workspace'
	})

	const result = await brain.run({
		skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'ephemeral' } },
		workerId: 'topic-jaensen-architecture',
		actorState: {},
		envelope: makeEnvelopeRecord()
	})

	expect(calls).toEqual([
		{ type: 'session', value: 'actor/skill/memory' },
		{ type: 'task', value: 'called' }
	])
	expect(result.state).toEqual({ temp: true })
})

test('worker accepts flue responses wrapped in data', async () => {
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						return { data: { state: { persisted: true }, result: { ok: true }, completed: true } }
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
		brain.run({
			skill: { ...baseSkill, frontmatter: { ...baseSkill.frontmatter, worker_policy: 'durable' } },
			workerId: 'topic-jaensen-architecture',
			actorState: {},
			envelope: makeEnvelopeRecord()
		})
	).resolves.toMatchObject({ state: { persisted: true }, result: { ok: true }, completed: true })
})

test('ephemeral worker smoke task can create sandbox file and return ok', async () => {
	const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'jaensen-smoke-'))
	const brain = createFlueSkillWorkerBrain({
		harness: {
			async session() {
				return {
					async prompt() {
						throw new Error('unexpected prompt')
					},
					async task(_text, options) {
						const shellResult = await this.shell(
							'mkdir -p artifacts/smoke && echo "ok" > artifacts/smoke/sandbox.txt && cat artifacts/smoke/sandbox.txt',
							{ cwd: options.cwd }
						)
						return { state: { smoke: true }, result: { output: shellResult.stdout.trim() }, completed: true }
					},
					async shell(command, options) {
						const proc = Bun.spawn(['/bin/bash', '-lc', command], {
							cwd: options?.cwd,
							stdout: 'pipe',
							stderr: 'pipe'
						})
						const [stdout, stderr, exitCode] = await Promise.all([
							new Response(proc.stdout).text(),
							new Response(proc.stderr).text(),
							proc.exited
						])
						return { stdout, stderr, exitCode }
					}
				}
			}
		},
		workspaceRoot
	})

	await expect(
		brain.run({
			skill: { ...baseSkill, id: 'smoke', frontmatter: { ...baseSkill.frontmatter, worker_policy: 'ephemeral' } },
			workerId: 'call-1',
			actorState: {},
			envelope: makeEnvelopeRecord()
		})
	).resolves.toMatchObject({ result: { output: 'ok' }, completed: true })
	expect(await readFile(path.join(workspaceRoot, 'artifacts/smoke/sandbox.txt'), 'utf8')).toBe('ok\n')
})

function makeEnvelopeRecord(overrides: Partial<EnvelopeRecord> = {}): EnvelopeRecord {
	return {
		id: 'env-1',
		fromActor: 'skill/memory',
		toActor: 'skill-worker/memory/topic-jaensen-architecture',
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