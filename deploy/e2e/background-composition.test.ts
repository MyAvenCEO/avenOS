import { expect, test } from 'bun:test'
import { backgroundComposition } from './background-composition'

test('background qualification is opt-in, complete and uses a fresh exchange secret', () => {
	expect(backgroundComposition(false)).toEqual({ services: {} })
	const a = backgroundComposition(true).services
	const b = backgroundComposition(true).services
	expect(Object.keys(a).sort()).toEqual(['actor-runner', 'api', 'intent-service'])
	const token = a.api!.environment.WORK_GRANT_EXCHANGE_BEARER_TOKEN
	expect(token).toMatch(/^[a-f0-9]{64}$/)
	expect(b.api!.environment.WORK_GRANT_EXCHANGE_BEARER_TOKEN).not.toBe(token)
	expect(a['actor-runner']!.environment.WORK_GRANT_EXCHANGE_BEARER_TOKEN).toBe(token)
	expect(a['intent-service']!.environment.WORK_GRANT_EXCHANGE_BEARER_TOKEN).toBe(token)
	expect(Object.keys(a['actor-runner']!.environment)).toHaveLength(5)
	expect(Object.keys(a['intent-service']!.environment)).toHaveLength(4)
})
