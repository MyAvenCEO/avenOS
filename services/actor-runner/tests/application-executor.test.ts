import { expect, test } from 'vitest'
import { createApplicationExecutor } from '../src/application-executor'

test('unknown exploration fails instead of succeeding with zero work', async () => {
	const execute = createApplicationExecutor([], async () => ({ remainingGoals: [] }))
	await expect(
		Promise.resolve().then(() =>
			execute({ skillRef: 'missing@2', goalSpec: { mode: 'explore' } } as Parameters<
				typeof execute
			>[0])
		)
	).rejects.toThrow('not installed')
})
