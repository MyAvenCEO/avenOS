import { expect, test } from 'bun:test'

import { buildSupervisorPrompt, buildWorkerPrompt } from '../src/index'

const skill = {
	id: 'file-creator',
	path: 'file-creator/SKILL.md',
	description: 'Create files',
	directActors: ['skill/memory'],
	frontmatter: { id: 'file-creator', direct_actors: ['skill/memory'] },
	body: 'Create files and remember them.',
	bodyHash: 'hash',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('worker prompt includes exact call_skill example', () => {
	const prompt = buildWorkerPrompt({
		skill,
		workerId: 'call-1',
		actorState: {},
		envelope: { id: 'env-1', payload: {}, fromActor: 'skill/file-creator' } as never,
		workspaceRoot: '/workspace',
		resourceHints: {},
		workerPolicy: 'durable'
	})

	expect(prompt).toContain('Return JSON only. Use this exact minimal shape')
	expect(prompt).toContain('"type": "call_skill"')
	expect(prompt).toContain('"callId": "remember-file-greeting-txt"')
	expect(prompt).toContain('"request": "store"')
	expect(prompt).toContain('Never call your own skill actor (skill/file-creator)')
	expect(prompt).toContain('Example of direct completion without any skill call:')
})

test('supervisor prompt includes exact decision shape and call_skill example', () => {
	const prompt = buildSupervisorPrompt({
		skill,
		actorState: {},
		envelope: { id: 'env-1', payload: {}, fromActor: 'intent/test' } as never,
		knownWorkers: {},
		workspaceRoot: '/workspace'
	})

	expect(prompt).toContain('Return JSON only. Use this exact shape:')
	expect(prompt).toContain('"actions": []')
	expect(prompt).toContain('"type": "call_skill"')
})