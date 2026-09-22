import { ArtifactStoreProblem } from '@avenos/artifact-store'
import { describe, expect, test } from 'vitest'
import { studioFailure } from '../src/studio-errors.js'

describe('Studio error settlement', () => {
	test('reports catalog reconciliation as a definite rejection', () => {
		expect(
			studioFailure(
				new ArtifactStoreProblem(503, 'STORE_RECONCILIATION_REQUIRED', 'untrusted upstream detail')
			)
		).toEqual({
			status: 503,
			effect: 'not-applied',
			problem: {
				code: 'STUDIO_STORE_RECONCILIATION_REQUIRED',
				message:
					'This workspace is still installing its current artifact catalog. No Studio change was committed. Retry after workspace setup is ready.',
				storeCode: 'STORE_RECONCILIATION_REQUIRED',
				retryable: true
			}
		})
	})

	test('does not infer rejection from an unrelated service failure', () => {
		expect(studioFailure(new ArtifactStoreProblem(503, 'UPSTREAM_TIMEOUT', 'unknown'))).toBe(
			undefined
		)
	})
})
