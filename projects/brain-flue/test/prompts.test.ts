import { expect, test } from 'bun:test'

import { buildSupervisorPrompt, buildWorkerPrompt } from '../src/index'

const skill = {
	id: 'file-creator',
	path: 'file-creator/SKILL.md',
	description: 'Create files',
	directActors: ['aven/skills/memory'],
	frontmatter: { id: 'file-creator', direct_actors: ['aven/skills/memory'] },
	body: 'Create files and remember them.',
	bodyHash: 'hash',
	loadedAt: '2026-05-12T00:00:00.000Z'
}

test('worker prompt includes exact call_skill example', () => {
	const prompt = buildWorkerPrompt({
		skill,
		workerActorId: 'aven/skills/file-creator/workers/call-1-abc123',
		workerName: 'call-1-abc123',
		actorState: {},
		envelope: { id: 'env-1', payload: {}, fromActor: 'aven/skills/file-creator' } as never,
		workspaceRoot: '/workspace',
		resourceHints: {},
		workerPolicy: 'durable'
	})

	expect(prompt).toContain('Return JSON only as tool calls.')
	expect(prompt).toContain('"tool": "call_skill"')
	expect(prompt).toContain('"callId": "remember-file-greeting-txt"')
	expect(prompt).toContain('"request": "store"')
	expect(prompt).toContain('"tool": "finish"')
	expect(prompt).toContain('Never call your own skill actor (aven/skills/file-creator)')
	expect(prompt).toContain('Example of direct completion without any skill call:')
})

test('supervisor prompt includes exact decision shape and call_skill example', () => {
	const prompt = buildSupervisorPrompt({
		skill,
		actorState: {},
		envelope: { id: 'env-1', payload: {}, fromActor: 'intents/test' } as never,
		knownWorkers: {},
		workspaceRoot: '/workspace'
	})

	expect(prompt).toContain('Return JSON only. Use this exact shape:')
	expect(prompt).toContain('"actions": []')
	expect(prompt).toContain('"type": "call_skill"')
})