import { expect, test } from 'bun:test'

import {
	createSupervisorSessionName,
	createWorkerSessionName,
	isSlugSafe
} from '../src/index'
import { createWorkerActorId } from '@jaensen/persistence-sqlite'

test('creates stable supervisor session name', () => {
	expect(createSupervisorSessionName('memory')).toBe('actor/aven/skills/memory')
})

test('creates stable worker session name', () => {
	const workerActorId = createWorkerActorId('memory', 'topic-jaensen-architecture')
	expect(createWorkerSessionName(workerActorId)).toBe(`actor/${workerActorId}`)
})

test('validates slug-safe worker ids', () => {
	expect(isSlugSafe('job-01')).toBe(true)
	expect(isSlugSafe('Job_01')).toBe(false)
})