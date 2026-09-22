import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { mailArtifactTypes } from '../src/artifact-types'

it('keeps the registered Artifact Store shapes aligned with the runtime mail contracts', async () => {
	for (const type of mailArtifactTypes()) {
		const stored = JSON.parse(
			await readFile(
				new URL(
					`../../../services/artifact-store/conformance/fixtures/protocol/${type.typeKey}.v1.json`,
					import.meta.url
				),
				'utf8'
			)
		)
		expect(stored).toEqual(type)
	}
})
